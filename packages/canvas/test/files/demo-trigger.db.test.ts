import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@pluto/core/database.types";
import type { PlutoDb } from "@pluto/core/context";
import { AlertDeadlineChangeRequest, INTERNAL_SECRET_HEADER } from "@pluto/core/contract";
import { NOTES_BUCKET } from "@pluto/core/ingest";
import { createCanvasClient, type CanvasClient } from "../../src/client";
import {
  createDeadlineChangeNotifier,
  createDemoFixturesFetch,
  runDemoDateChange,
  type DemoDateChangeResult,
} from "../../src/demo-trigger";
import { createFixtureFileFetch } from "../../src/files-sync";
import { createDiskFixturesFetch, syncCanvas } from "../../src/sync";
import { dbEnv, SKIP_DB_TESTS } from "../db-env";

const BASE = "https://fixtures.canvas.local";
const APP_URL = "http://app.test";
const SECRET = "demo-trigger-test-secret";

function service(): PlutoDb {
  const env = dbEnv();
  return createClient<Database>(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) }),
    },
  });
}

/** The same composition as POST /api/canvas/demo-date-change. */
function demoClient(): CanvasClient {
  return createCanvasClient({
    baseUrl: BASE,
    token: "",
    mode: "fixtures",
    fetch: createDemoFixturesFetch(createDiskFixturesFetch(BASE)),
  });
}

function normalClient(): CanvasClient {
  return createCanvasClient({ baseUrl: BASE, token: "", mode: "fixtures", fetch: createDiskFixturesFetch(BASE) });
}

/**
 * Stand-in for POST /api/alerts/deadline-change (PR #51, not merged here): checks the
 * secret and body, then writes what that route writes: one alert and one outbound SMS.
 */
function fakeAlertsRoute(admin: PlutoDb): { fetch: typeof fetch; posts: unknown[] } {
  const posts: unknown[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url !== `${APP_URL}/api/alerts/deadline-change`) return new Response("not found", { status: 404 });
    if (new Headers(init?.headers).get(INTERNAL_SECRET_HEADER) !== SECRET) return new Response("no", { status: 401 });
    const body = AlertDeadlineChangeRequest.parse(JSON.parse(String(init?.body)));
    posts.push(body);
    const { data: assignment } = await admin
      .from("assignments")
      .select("title, courses(name)")
      .eq("student_id", body.studentId)
      .eq("id", body.assignmentId)
      .single();
    const fmt = (iso: string) =>
      new Date(iso).toLocaleString("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    const message = `Pluto: "${assignment?.title}" (${assignment?.courses?.name}) moved from ${fmt(body.oldDueAt)} to ${fmt(body.newDueAt)}.`;
    const { data: alert, error } = await admin
      .from("alerts")
      .insert({ student_id: body.studentId, kind: "date_change", assignment_id: body.assignmentId, message })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const sms = await admin
      .from("sms_messages")
      .insert({ student_id: body.studentId, direction: "outbound", body: message, provider: "simulator" });
    if (sms.error) throw new Error(sms.error.message);
    return Response.json({ alertId: alert.id, sent: true });
  };
  return { fetch: impl, posts };
}

async function createUser(db: PlutoDb): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({
    email: `canvas-demo-${randomBytes(8).toString("hex")}@pluto.test`,
    password: `pw-${randomBytes(12).toString("hex")}`,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? "createUser failed");
  return data.user.id;
}

async function cleanup(db: PlutoDb, studentId: string): Promise<void> {
  const { data } = await db.storage.from(NOTES_BUCKET).list(studentId, { limit: 1000 });
  const paths = (data ?? []).map((object) => `${studentId}/${object.name}`);
  if (paths.length > 0) await db.storage.from(NOTES_BUCKET).remove(paths);
  const { error } = await db.auth.admin.deleteUser(studentId);
  if (error) console.warn(`cleanup: could not delete ${studentId}: ${error.message}`);
}

async function counts(db: PlutoDb, studentId: string) {
  const alerts = await db
    .from("alerts")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .eq("kind", "date_change");
  const sms = await db
    .from("sms_messages")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .eq("direction", "outbound");
  return { dateChangeAlerts: alerts.count ?? 0, outboundSms: sms.count ?? 0 };
}

async function midterm(db: PlutoDb, studentId: string) {
  const { data, error } = await db
    .from("assignments")
    .select("id, title, due_at, previous_due_at, due_changed_at")
    .eq("student_id", studentId)
    .eq("canvas_assignment_id", "seed-103")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

function summary(result: DemoDateChangeResult) {
  return {
    dueDateChanges: result.sync.dueDateChanges.map((change) => `${change.title}: ${change.oldDueAt} -> ${change.newDueAt}`),
    syncErrors: result.sync.errors,
    files: result.files,
    alerts: result.alerts.map((alert) => `${alert.title}: ${alert.status}`),
  };
}

describe.skipIf(SKIP_DB_TESTS)("runDemoDateChange", () => {
  let db: PlutoDb | undefined;
  const created: string[] = [];

  afterAll(async () => {
    if (!db) return;
    for (const id of created) await cleanup(db, id);
  });

  it("moves the History 105 midterm once, sends one text, and a rerun sends nothing", async () => {
    db = service();
    const admin = db;
    const student = await createUser(admin);
    created.push(student);

    // Starting point = the normal fixtures (what the seeded demo student already has).
    expect((await syncCanvas({ db: admin, studentId: student, client: normalClient() })).errors).toEqual([]);
    const before = await midterm(admin, student);
    const countsBefore = await counts(admin, student);

    const route = fakeAlertsRoute(admin);
    const run = () =>
      runDemoDateChange({
        admin,
        studentId: student,
        client: demoClient(),
        notifier: createDeadlineChangeNotifier({
          admin,
          studentId: student,
          appUrl: APP_URL,
          internalSecret: SECRET,
          fetch: route.fetch,
        }),
        files: { download: { baseUrl: BASE, fetch: createFixtureFileFetch() } },
      });

    const first = await run();
    const after1 = await midterm(admin, student);
    const counts1 = await counts(admin, student);
    console.log(`DEMO_RUN first ${JSON.stringify({ before: countsBefore, after: counts1, ...summary(first) })}`);
    console.log(`DEMO_MIDTERM ${JSON.stringify({ before, after: after1 })}`);

    expect(first.sync.dueDateChanges).toHaveLength(1);
    expect(first.alerts).toEqual([expect.objectContaining({ title: "Midterm Exam", status: "sent" })]);
    expect(route.posts).toHaveLength(1);
    expect(counts1).toEqual({
      dateChangeAlerts: countsBefore.dateChangeAlerts + 1,
      outboundSms: countsBefore.outboundSms + 1,
    });
    expect(Date.parse(after1.previous_due_at!)).toBe(Date.parse(before.due_at!));
    expect(Date.parse(before.due_at!) - Date.parse(after1.due_at!)).toBe(2 * 24 * 60 * 60 * 1000);
    expect(after1.due_changed_at).not.toBeNull();
    expect(first.files).toMatchObject({ ingested: 3, failed: 0 });

    const { data: sms } = await admin
      .from("sms_messages")
      .select("body")
      .eq("student_id", student)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    console.log(`DEMO_SMS ${sms?.body}`);

    const second = await run();
    const counts2 = await counts(admin, student);
    console.log(`DEMO_RUN second ${JSON.stringify({ after: counts2, ...summary(second) })}`);
    expect(second.sync.dueDateChanges).toHaveLength(0);
    expect(second.alerts).toEqual([]);
    expect(route.posts).toHaveLength(1);
    expect(counts2).toEqual(counts1);
    expect(second.files).toMatchObject({ downloaded: 0, skipped: 3 });

    // Rehearsal case: something moved the date back, then the demo runs again within the
    // hour. The notifier's duplicate guard still sends nothing.
    await syncCanvas({ db: admin, studentId: student, client: normalClient() });
    const third = await run();
    const counts3 = await counts(admin, student);
    console.log(`DEMO_RUN after-revert ${JSON.stringify({ after: counts3, ...summary(third) })}`);
    expect(third.sync.dueDateChanges).toHaveLength(1);
    expect(third.alerts).toEqual([expect.objectContaining({ status: "duplicate" })]);
    expect(route.posts).toHaveLength(1);
    expect(counts3).toEqual(counts1);
  });
});
