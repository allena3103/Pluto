// Shared helpers for DB tests. Tests create throwaway users (unique emails) and delete them afterwards;
// deleting the auth user cascades to the profile and every row it owns.
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { expect } from "vitest";
import { dbEnv } from "../db-env";

const HTTP_TIMEOUT_MS = 20_000;

/** Every public table and the column that names its owning student. A new table must be added here. */
export const OWNER_COLUMN: Record<string, string> = {
  profiles: "id",
  courses: "student_id",
  grade_groups: "student_id",
  assignments: "student_id",
  files: "student_id",
  file_pages: "student_id",
  chat_sessions: "student_id",
  chat_messages: "student_id",
  magic_links: "student_id",
  phone_link_codes: "student_id",
  alerts: "student_id",
  study_blocks: "student_id",
  sms_messages: "student_id",
};

/** Tables a signed-in student may read (magic_links and phone_link_codes are service role only). */
export const STUDENT_READABLE = Object.keys(OWNER_COLUMN).filter(
  (t) => t !== "magic_links" && t !== "phone_link_codes",
);

function client(key: string): SupabaseClient {
  return createClient(dbEnv().url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS) }),
    },
  });
}

export function serviceClient(): SupabaseClient {
  return client(dbEnv().serviceRoleKey);
}

export function anonClient(): SupabaseClient {
  return client(dbEnv().anonKey);
}

export async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const c = anonClient();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign-in failed for ${email}: ${error?.message ?? "no session"}`);
  return c;
}

export function requireTestEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`DB tests need ${name}. Run \`npm run env:local\` and \`npm run seed\`.`);
  return value;
}

export interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
}

export async function createThrowawayUser(service: SupabaseClient, name = "RLS Throwaway"): Promise<TestUser> {
  const email = `rls-${randomBytes(8).toString("hex")}@pluto.test`;
  const password = `pw-${randomBytes(12).toString("hex")}`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message ?? "no user"}`);
  try {
    return { id: data.user.id, email, client: await signIn(email, password) };
  } catch (err) {
    await service.auth.admin.deleteUser(data.user.id);
    throw err;
  }
}

export async function deleteUsers(service: SupabaseClient, users: Array<TestUser | undefined>): Promise<void> {
  for (const user of users) {
    if (!user) continue;
    const { error } = await service.auth.admin.deleteUser(user.id);
    if (error) console.warn(`cleanup: could not delete ${user.email}: ${error.message}`);
  }
}

/** Runs one query over a direct Postgres connection (for catalog checks PostgREST cannot do). */
export async function pgQuery<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({
    connectionString: requireTestEnv("SUPABASE_DB_URL"),
    statement_timeout: 20_000,
    connectionTimeoutMillis: 10_000,
  });
  await c.connect();
  try {
    return (await c.query<T>(sql, params)).rows;
  } finally {
    await c.end();
  }
}

interface QueryResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}

/** Rows a query exposed. A permission-denied error (42501) counts as zero rows; any other error fails. */
export function rowsOrDenied(res: QueryResult, label: string): Array<Record<string, unknown>> {
  if (res.error) {
    expect(res.error.code, `${label}: unexpected error ${res.error.message}`).toBe("42501");
    return [];
  }
  return (res.data as Array<Record<string, unknown>> | null) ?? [];
}

/** Unwraps a service-role result that must succeed. */
export function must<T>(res: { data: T | null; error: { message: string } | null }, label: string): T {
  if (res.error || res.data === null) throw new Error(`${label}: ${res.error?.message ?? "no data"}`);
  return res.data;
}

export interface OwnedRows {
  studentId: string;
  courseId: string;
  gradeGroupId: string;
  assignmentId: string;
  fileId: string;
  filePageId: string;
  chatSessionId: string;
  chatMessageId: string;
  magicLinkId: string;
  phoneLinkCodeId: string;
  alertId: string;
  studyBlockId: string;
  smsMessageId: string;
}

/** Service role creates one row in every table for the student. */
export async function createRowInEveryTable(service: SupabaseClient, studentId: string): Promise<OwnedRows> {
  const one = async (table: string, row: Record<string, unknown>): Promise<string> => {
    const data = must(await service.from(table).insert({ student_id: studentId, ...row }).select("id").single(), table);
    return (data as unknown as { id: string }).id;
  };
  const tag = randomBytes(4).toString("hex");
  const courseId = await one("courses", { name: `RLS Course ${tag}`, term: "Test" });
  const gradeGroupId = await one("grade_groups", { course_id: courseId, name: "Group", weight_percent: 100 });
  const assignmentId = await one("assignments", {
    course_id: courseId,
    grade_group_id: gradeGroupId,
    title: `RLS Assignment ${tag}`,
    due_at: new Date(Date.now() + 86_400_000).toISOString(),
    points_possible: 10,
  });
  const fileId = await one("files", { course_id: courseId, title: `RLS File ${tag}`, source: "manual" });
  const filePageId = await one("file_pages", { file_id: fileId, page_number: 1, text: `secret page ${tag}` });
  const chatSessionId = await one("chat_sessions", { channel: "web", title: "RLS chat" });
  const chatMessageId = await one("chat_messages", {
    session_id: chatSessionId,
    role: "user",
    text: "secret message",
    channel: "web",
    cited_file_id: fileId,
    cited_page: 1,
  });
  const magicLinkId = await one("magic_links", {
    token_hash: randomBytes(32).toString("hex"),
    file_id: fileId,
    page: 1,
    expires_at: new Date(Date.now() + 900_000).toISOString(),
  });
  const phoneLinkCodeId = await one("phone_link_codes", {
    code_hash: randomBytes(32).toString("hex"),
    expires_at: new Date(Date.now() + 900_000).toISOString(),
  });
  const alertId = await one("alerts", {
    kind: "date_change",
    assignment_id: assignmentId,
    message: "secret alert",
    calendar_feed_token: randomBytes(16).toString("hex"),
  });
  const studyBlockId = await one("study_blocks", {
    alert_id: alertId,
    course_id: courseId,
    title: "Study",
    starts_at: new Date(Date.now() + 3_600_000).toISOString(),
    ends_at: new Date(Date.now() + 7_200_000).toISOString(),
  });
  const smsMessageId = await one("sms_messages", { direction: "inbound", body: "secret sms", provider: "simulator" });
  return {
    studentId,
    courseId,
    gradeGroupId,
    assignmentId,
    fileId,
    filePageId,
    chatSessionId,
    chatMessageId,
    magicLinkId,
    phoneLinkCodeId,
    alertId,
    studyBlockId,
    smsMessageId,
  };
}

/** A valid insert payload per table that tries to create a row owned by `target`. */
export function insertPayloads(target: {
  studentId: string;
  courseId?: string;
  fileId?: string;
  chatSessionId?: string;
  alertId?: string;
}): Record<string, Record<string, unknown>> {
  const s = target.studentId;
  const courseId = target.courseId ?? randomUUID();
  const fileId = target.fileId ?? randomUUID();
  const sessionId = target.chatSessionId ?? randomUUID();
  const alertId = target.alertId ?? randomUUID();
  const soon = new Date(Date.now() + 3_600_000).toISOString();
  const later = new Date(Date.now() + 7_200_000).toISOString();
  return {
    profiles: { id: randomUUID(), name: "intruder" },
    courses: { student_id: s, name: "intruder course" },
    grade_groups: { student_id: s, course_id: courseId, name: "intruder", weight_percent: 1 },
    assignments: { student_id: s, course_id: courseId, title: "intruder" },
    files: { student_id: s, course_id: courseId, title: "intruder", source: "manual" },
    file_pages: { student_id: s, file_id: fileId, page_number: 99, text: "intruder" },
    chat_sessions: { student_id: s, channel: "web", title: "intruder" },
    chat_messages: { student_id: s, session_id: sessionId, role: "user", text: "intruder", channel: "web" },
    magic_links: { student_id: s, token_hash: randomBytes(32).toString("hex"), file_id: fileId, page: 1, expires_at: soon },
    phone_link_codes: { student_id: s, code_hash: randomBytes(32).toString("hex"), expires_at: soon },
    alerts: { student_id: s, kind: "crunch_week", message: "intruder" },
    study_blocks: { student_id: s, alert_id: alertId, title: "intruder", starts_at: soon, ends_at: later },
    sms_messages: { student_id: s, direction: "inbound", body: "intruder" },
  };
}
