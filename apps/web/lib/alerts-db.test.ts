import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AlertResponse } from "@pluto/core/contract";
import type { Database } from "@pluto/core/database.types";
import { config } from "dotenv";
import ICAL from "ical.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleAlertsDemo } from "./alerts-demo";
import { handleCalFeed } from "./cal-feed";
import { handleDeadlineChange } from "./deadline-change";

// Real local Supabase. Two throwaway students; everything they own is deleted afterwards.

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY
) {
  if (existsSync(envFile)) config({ path: envFile, quiet: true });
}

// Copied locally. packages/core/test is not a public export.
const SKIP_DB_TESTS = process.env.PLUTO_SKIP_DB_TESTS === "1";
const HTTP_TIMEOUT_MS = 20_000;
const SECRET = "alerts-db-test-secret";
const APP = "http://localhost:3405";
const DAY_MS = 24 * 60 * 60 * 1000;

type Db = SupabaseClient<Database>;

function adminClient(): Db {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("DB tests need local Supabase env. Run `npm run env:local` (or set PLUTO_SKIP_DB_TESTS=1 to skip, CI only).");
  }
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS) }),
    },
  });
}

function randomPhone(): string {
  const n = randomBytes(4).readUInt32BE(0) % 10_000_000;
  return `+1557${String(n).padStart(7, "0")}`;
}

function post(path: string, body: unknown, secret: string | null = SECRET): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-internal-secret"] = secret;
  return new Request(`http://localhost${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function tokenOf(calendarUrl: string): string {
  const match = /\/cal\/([^/]+)\.ics$/.exec(calendarUrl);
  if (!match?.[1]) throw new Error(`not a feed url: ${calendarUrl}`);
  return match[1];
}

type ParsedEvent = { uid: string; summary: string; start: string; end: string };

async function fetchFeed(admin: Db, calendarUrl: string): Promise<{ status: number; events: ParsedEvent[] }> {
  const res = await handleCalFeed(`${tokenOf(calendarUrl)}.ics`, { createAdmin: () => admin });
  if (res.status !== 200) return { status: res.status, events: [] };
  expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
  const calendar = new ICAL.Component(ICAL.parse(await res.text()));
  const events = calendar.getAllSubcomponents("vevent").map((vevent) => {
    const event = new ICAL.Event(vevent);
    return {
      uid: event.uid,
      summary: event.summary,
      start: event.startDate.toJSDate().toISOString(),
      end: event.endDate.toJSDate().toISOString(),
    };
  });
  return { status: 200, events };
}

/** Next week's Monday 00:00 UTC plus `days` and `hours`. Always in the future and inside the 8-week horizon. */
function nextWeek(days: number, hours: number): string {
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7 || 7));
  return new Date(monday.getTime() + days * DAY_MS + hours * 3_600_000).toISOString();
}

type Student = { id: string; courseId: string; assignmentIds: string[] };

describe.skipIf(SKIP_DB_TESTS)("alerts and ICS feed against the local database", () => {
  let admin: Db;
  let a: Student; // has a phone and three assignments in one week
  let b: Student; // no phone, one assignment
  const userIds: string[] = [];

  async function makeStudent(label: string, phone: string | null, dueDates: string[]): Promise<Student> {
    const email = `alerts-${label}-${randomUUID()}@pluto.test`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: randomUUID(), email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    const id = data.user.id;
    userIds.push(id);
    if (phone) {
      const { error: phoneError } = await admin.from("profiles").update({ phone }).eq("id", id);
      if (phoneError) throw new Error(phoneError.message);
    }
    const { data: course, error: courseError } = await admin
      .from("courses")
      .insert({ student_id: id, name: `Course ${label}` })
      .select("id")
      .single();
    if (courseError || !course) throw new Error(`course insert failed: ${courseError?.message}`);
    const { data: rows, error: rowsError } = await admin
      .from("assignments")
      .insert(dueDates.map((due_at, i) => ({ student_id: id, course_id: course.id, title: `${label} task ${i + 1}`, due_at })))
      .select("id");
    if (rowsError || !rows) throw new Error(`assignment insert failed: ${rowsError?.message}`);
    return { id, courseId: course.id, assignmentIds: rows.map((r) => r.id) };
  }

  async function alertCount(studentId: string): Promise<number> {
    const { count, error } = await admin.from("alerts").select("id", { count: "exact", head: true }).eq("student_id", studentId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async function outboundTexts(studentId: string): Promise<string[]> {
    const { data, error } = await admin
      .from("sms_messages")
      .select("body")
      .eq("student_id", studentId)
      .eq("direction", "outbound")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.body);
  }

  const demoDeps = (sessionUserId: string | null = null) => ({
    expectedSecret: SECRET,
    appUrl: APP,
    provider: "simulator" as const,
    getSessionUserId: async () => sessionUserId,
    createAdmin: () => admin,
  });
  const changeDeps = () => ({ expectedSecret: SECRET, appUrl: APP, provider: "simulator" as const, createAdmin: () => admin });

  beforeAll(async () => {
    admin = adminClient();
    a = await makeStudent("a", randomPhone(), [nextWeek(1, 16), nextWeek(2, 16), nextWeek(3, 16)]);
    b = await makeStudent("b", null, [nextWeek(14, 16)]);
  }, 60_000);

  afterAll(async () => {
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("crunch demo (internal secret) texts the student and serves a feed with that week's blocks", async () => {
    const res = await handleAlertsDemo(post("/api/alerts/demo", { studentId: a.id }), demoDeps());
    expect(res.status).toBe(200);
    const body = AlertResponse.parse(await res.json());
    expect(body.sent).toBe(true);
    expect(body.calendarUrl).toMatch(new RegExp(`^${APP}/cal/[A-Za-z0-9_-]+\\.ics$`));

    const texts = await outboundTexts(a.id);
    expect(texts.at(-1)).toContain(body.calendarUrl);
    expect(texts.at(-1)).toContain("3 things due");

    const { data: alert } = await admin.from("alerts").select("kind,week_start,sent_at,student_id").eq("id", body.alertId).single();
    expect(alert).toMatchObject({ kind: "crunch_week", student_id: a.id, week_start: nextWeek(0, 0).slice(0, 10) });
    expect(alert?.sent_at).not.toBeNull();

    const feed = await fetchFeed(admin, body.calendarUrl);
    expect(feed.status).toBe(200);
    expect(feed.events.map((e) => e.summary)).toEqual([
      "Study: a task 1 (Course a)",
      "Study: a task 2 (Course a)",
      "Study: a task 3 (Course a)",
    ]);
    expect(feed.events[0]?.end).toBe(nextWeek(1, 16));
    expect(new Date(feed.events[0]!.end).getTime() - new Date(feed.events[0]!.start).getTime()).toBe(90 * 60_000);
  });

  it("crunch demo by session works for the student and is 403 for anyone else, writing nothing", async () => {
    const own = await handleAlertsDemo(post("/api/alerts/demo", { studentId: b.id }, null), demoDeps(b.id));
    expect(own.status).toBe(200);
    const body = AlertResponse.parse(await own.json());
    expect(body.sent).toBe(false); // b has no phone; the alert row stays
    expect(await alertCount(b.id)).toBe(1);

    const beforeA = await alertCount(a.id);
    const cross = await handleAlertsDemo(post("/api/alerts/demo", { studentId: a.id }, null), demoDeps(b.id));
    expect(cross.status).toBe(403);
    const wrong = await handleAlertsDemo(post("/api/alerts/demo", { studentId: a.id }, "wrong"), demoDeps());
    expect(wrong.status).toBe(401);
    expect(await alertCount(a.id)).toBe(beforeA);
  });

  it("deadline change texts the new date and serves a feed with only the moved block", async () => {
    const newDueAt = nextWeek(4, 16);
    const res = await handleDeadlineChange(
      post("/api/alerts/deadline-change", { studentId: a.id, assignmentId: a.assignmentIds[0], oldDueAt: nextWeek(1, 16), newDueAt }),
      changeDeps(),
    );
    expect(res.status).toBe(200);
    const body = AlertResponse.parse(await res.json());
    expect(body.sent).toBe(true);
    expect((await outboundTexts(a.id)).at(-1)).toContain(body.calendarUrl);

    const { data: alert } = await admin.from("alerts").select("kind,assignment_id,student_id").eq("id", body.alertId).single();
    expect(alert).toEqual({ kind: "date_change", assignment_id: a.assignmentIds[0], student_id: a.id });

    const feed = await fetchFeed(admin, body.calendarUrl);
    expect(feed.events).toHaveLength(1);
    expect(feed.events[0]).toMatchObject({ summary: "Study: a task 1 (Course a)", end: newDueAt });
  });

  it("deadline change for a student with no phone keeps the alert and returns sent: false", async () => {
    const before = await alertCount(b.id);
    const res = await handleDeadlineChange(
      post("/api/alerts/deadline-change", {
        studentId: b.id,
        assignmentId: b.assignmentIds[0],
        oldDueAt: nextWeek(14, 16),
        newDueAt: nextWeek(15, 16),
      }),
      changeDeps(),
    );
    expect(res.status).toBe(200);
    expect(AlertResponse.parse(await res.json()).sent).toBe(false);
    expect(await alertCount(b.id)).toBe(before + 1);
  });

  it("another student's id never touches the other student's rows", async () => {
    const beforeA = await alertCount(a.id);
    const beforeB = await alertCount(b.id);
    const textsA = (await outboundTexts(a.id)).length;

    // b's id with a's assignment, and a's id with b's assignment: both not found.
    for (const pair of [
      { studentId: b.id, assignmentId: a.assignmentIds[1] },
      { studentId: a.id, assignmentId: b.assignmentIds[0] },
    ]) {
      const res = await handleDeadlineChange(
        post("/api/alerts/deadline-change", { ...pair, oldDueAt: nextWeek(2, 16), newDueAt: nextWeek(5, 16) }),
        changeDeps(),
      );
      expect(res.status).toBe(404);
    }

    expect(await alertCount(a.id)).toBe(beforeA);
    expect(await alertCount(b.id)).toBe(beforeB);
    expect((await outboundTexts(a.id)).length).toBe(textsA);
  });

  it("each feed holds only its own student's blocks; unknown tokens are 404", async () => {
    const { data: alerts } = await admin
      .from("alerts")
      .select("calendar_feed_token,student_id")
      .in("student_id", [a.id, b.id]);
    expect(alerts?.length).toBeGreaterThan(0);
    for (const alert of alerts ?? []) {
      const feed = await fetchFeed(admin, `${APP}/cal/${alert.calendar_feed_token}.ics`);
      const prefix = alert.student_id === a.id ? "Study: a " : "Study: b ";
      for (const event of feed.events) expect(event.summary.startsWith(prefix)).toBe(true);
    }
    expect((await handleCalFeed(`${randomBytes(32).toString("base64url")}.ics`, { createAdmin: () => admin })).status).toBe(404);
  });

  it("wrong or missing secret on deadline-change writes nothing", async () => {
    const before = await alertCount(a.id);
    const valid = { studentId: a.id, assignmentId: a.assignmentIds[2], oldDueAt: nextWeek(3, 16), newDueAt: nextWeek(6, 16) };
    expect((await handleDeadlineChange(post("/api/alerts/deadline-change", valid, null), changeDeps())).status).toBe(401);
    expect((await handleDeadlineChange(post("/api/alerts/deadline-change", valid, "nope"), changeDeps())).status).toBe(401);
    expect(await alertCount(a.id)).toBe(before);
  });
});
