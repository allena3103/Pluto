import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@pluto/core/database.types";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLinkCode } from "./phone-link";
import { processInboundSms, type SmsInboundDeps } from "./sms-inbound";

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  if (existsSync(envFile)) config({ path: envFile, quiet: true });
}

const SKIP_DB_TESTS = process.env.PLUTO_SKIP_DB_TESTS === "1";
const APP = "http://localhost:3603";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type Db = SupabaseClient<Database>;
type Student = { id: string; phone: string };

function randomPhone(): string {
  const n = randomBytes(4).readUInt32BE(0) % 10_000_000;
  return `+1557${String(n).padStart(7, "0")}`;
}

describe.skipIf(SKIP_DB_TESTS)("crunch-week YES reply against the local database", () => {
  let admin: Db;
  const userIds: string[] = [];

  function deps(): SmsInboundDeps {
    return { createAdmin: () => admin, appUrl: APP, provider: "simulator", llm: "mock" };
  }

  async function makeStudent(label: string): Promise<Student> {
    const email = `crunch-${label}-${randomUUID()}@pluto.test`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: randomUUID(), email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    const id = data.user.id;
    userIds.push(id);
    const phone = randomPhone();
    const { error: phoneError } = await admin.from("profiles").update({ phone }).eq("id", id);
    if (phoneError) throw new Error(phoneError.message);
    const { data: course, error: courseError } = await admin
      .from("courses")
      .insert({ student_id: id, name: `Course ${label}` })
      .select("id")
      .single();
    if (courseError || !course) throw new Error(`course insert failed: ${courseError?.message}`);
    const due = new Date(Date.now() + 2 * DAY_MS).toISOString();
    const { error: rowsError } = await admin
      .from("assignments")
      .insert({ student_id: id, course_id: course.id, title: `${label} essay`, due_at: due });
    if (rowsError) throw new Error(rowsError.message);
    return { id, phone };
  }

  /** A crunch alert for the week starting today, sent `ageMs` ago. */
  async function makeAlert(studentId: string, ageMs: number, extra: { sent?: boolean; week?: boolean } = {}) {
    const { error } = await admin.from("alerts").insert({
      student_id: studentId,
      kind: "crunch_week",
      week_start: extra.week === false ? null : new Date().toISOString().slice(0, 10),
      message: "Pluto: heavy week. Want a plan? Reply YES.",
      sent_at: extra.sent === false ? null : new Date(Date.now() - ageMs).toISOString(),
    });
    if (error) throw new Error(error.message);
  }

  async function say(student: Student, content: string) {
    return processInboundSms(
      { from_number: student.phone, content, message_handle: `crunch-${randomBytes(6).toString("hex")}` },
      deps(),
    );
  }

  async function outbound(studentId: string): Promise<string[]> {
    const { data, error } = await admin
      .from("sms_messages")
      .select("body")
      .eq("student_id", studentId)
      .eq("direction", "outbound")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.body);
  }

  beforeAll(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("DB tests need local Supabase env. Run `npm run env:local` (or set PLUTO_SKIP_DB_TESTS=1 to skip, CI only).");
    }
    admin = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  });

  afterAll(async () => {
    if (!admin) return;
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  });

  it("(a) a sent alert, then YES: the reply is a plan for that week and is stored", async () => {
    const student = await makeStudent("a");
    await makeAlert(student.id, HOUR_MS);
    const result = await say(student, "YES");
    expect(result).toMatchObject({ outcome: "answered", studentId: student.id, sent: true });
    expect(result.reply).toContain("Your plan:");
    expect(result.reply).toContain("a essay (Course a)");
    expect(result.reply!.length).toBeLessThan(600);
    expect(await outbound(student.id)).toEqual([result.reply]);
  });

  it("(b) YES with no alert, an old alert, an unsent alert or no week goes to the agent as plain text", async () => {
    const none = await makeStudent("b1");
    const old = await makeStudent("b2");
    await makeAlert(old.id, 25 * HOUR_MS);
    const unsent = await makeStudent("b3");
    await makeAlert(unsent.id, HOUR_MS, { sent: false });
    const noWeek = await makeStudent("b4");
    await makeAlert(noWeek.id, HOUR_MS, { week: false });
    for (const student of [none, old, unsent, noWeek]) {
      const result = await say(student, "yes");
      expect(result.outcome).toBe("answered");
      expect(result.reply).not.toContain("Your plan:");
      expect(await outbound(student.id)).toHaveLength(1);
    }
  });

  it("(b) text that is not a plain yes is never turned into a plan", async () => {
    const student = await makeStudent("b5");
    await makeAlert(student.id, HOUR_MS);
    for (const text of ["yes but what about grades", "no"]) {
      expect((await say(student, text)).reply).not.toContain("Your plan:");
    }
  });

  it("(c) another student's recent alert never triggers a plan for this student", async () => {
    const owner = await makeStudent("c1");
    await makeAlert(owner.id, HOUR_MS);
    const other = await makeStudent("c2");
    const result = await say(other, "yes");
    expect(result.reply).not.toContain("Your plan:");
    expect(result.reply).not.toContain("c1");
  });

  it("(d) LINK codes still work, even with a recent alert", async () => {
    const student = await makeStudent("d");
    await makeAlert(student.id, HOUR_MS);
    const phone = randomPhone();
    const { code } = await createLinkCode(admin, student.id);
    const result = await processInboundSms(
      { from_number: phone, content: `LINK ${code}`, message_handle: `crunch-${randomBytes(6).toString("hex")}` },
      deps(),
    );
    expect(result).toMatchObject({ outcome: "linked", studentId: student.id });
    const profile = await admin.from("profiles").select("phone").eq("id", student.id).single();
    expect(profile.data?.phone).toBe(phone);
  });
});
