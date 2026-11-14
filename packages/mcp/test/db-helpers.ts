import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { dbEnv } from "./db-env";

const HTTP_TIMEOUT_MS = 20_000;

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

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const c = client(dbEnv().anonKey);
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign-in failed for ${email}: ${error?.message ?? "no session"}`);
  return c;
}

export interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
}

export async function createThrowawayUser(service: SupabaseClient, name: string): Promise<TestUser> {
  const email = `mcp-${randomBytes(8).toString("hex")}@pluto.test`;
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

export function must<T>(res: { data: T | null; error: { message: string } | null }, label: string): T {
  if (res.error || res.data === null) throw new Error(`${label}: ${res.error?.message ?? "no data"}`);
  return res.data;
}

export function uniqueName(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

export async function createCourse(
  service: SupabaseClient,
  studentId: string,
  name: string,
): Promise<{ id: string; name: string }> {
  return must(
    await service.from("courses").insert({ student_id: studentId, name, term: "Fall 2026" }).select("id, name").single(),
    "create course",
  ) as { id: string; name: string };
}

export async function createFile(
  service: SupabaseClient,
  input: {
    studentId: string;
    courseId: string;
    title: string;
    pageCount: number;
    addedAt?: string;
  },
): Promise<{ id: string }> {
  return must(
    await service
      .from("files")
      .insert({
        student_id: input.studentId,
        course_id: input.courseId,
        title: input.title,
        added_at: input.addedAt ?? new Date().toISOString(),
        page_count: input.pageCount,
        ingest_status: "ready",
      })
      .select("id")
      .single(),
    "create file",
  ) as { id: string };
}

export async function insertPages(
  service: SupabaseClient,
  studentId: string,
  fileId: string,
  texts: string[],
): Promise<void> {
  const rows = texts.map((text, index) => ({
    student_id: studentId,
    file_id: fileId,
    page_number: index + 1,
    text,
  }));
  must(await service.from("file_pages").insert(rows).select("id"), "insert pages");
}
