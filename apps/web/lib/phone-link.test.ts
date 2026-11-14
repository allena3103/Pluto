import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@pluto/core/database.types";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LINK_CODE_PATTERN,
  LINK_CODE_TTL_MS,
  consumeLinkCode,
  createLinkCode,
  issueLinkCode,
  listLinkCodes,
  normalizePhone,
  selectLinkCodeHashes,
  setLinkCodeExpiresAt,
  type AdminClient,
} from "./phone-link";

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

function dbEnv(): { url: string; anonKey: string; serviceRoleKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
      "DB tests need local Supabase env. Run `npm run env:local` (or set PLUTO_SKIP_DB_TESTS=1 to skip, CI only).",
    );
  }
  return { url, anonKey, serviceRoleKey };
}

const HTTP_TIMEOUT_MS = 20_000;

function hashCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

function randomPhone(): string {
  const n = randomBytes(4).readUInt32BE(0) % 10_000_000;
  return `+1556${String(n).padStart(7, "0")}`;
}

function client(url: string, key: string): SupabaseClient<Database> {
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS) }),
    },
  });
}

describe("normalizePhone", () => {
  it("keeps a leading plus and the digits", () => {
    expect(normalizePhone("+1 (413) 555-0123")).toBe("+14135550123");
  });

  it("adds +1 to a 10-digit number and rejects junk", () => {
    expect(normalizePhone("4135550123")).toBe("+14135550123");
    expect(normalizePhone("(413) 555-0123")).toBe("+14135550123");
    expect(normalizePhone("14135550123")).toBe("+14135550123");
    expect(normalizePhone("not-a-phone")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("+0123456789")).toBeNull();
  });
});

describe("issueLinkCode", () => {
  it("returns 401 and does not call create when userId is null", async () => {
    let calls = 0;
    const result = await issueLinkCode({
      userId: null,
      create: () => {
        calls += 1;
        return { code: "ABCDEF", expiresAt: new Date().toISOString() };
      },
    });
    expect(result).toEqual({ status: 401 });
    expect(calls).toBe(0);
  });

  it("returns the minted code for a signed-in user", async () => {
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS).toISOString();
    const result = await issueLinkCode({
      userId: "student-1",
      create: async () => ({ code: "ABCDEF", expiresAt }),
    });
    expect(result).toEqual({ status: 200, code: "ABCDEF", expiresAt });
  });
});

type QueryResult = { data: unknown; error: { code?: string; message: string } | null };

function builder(result: QueryResult) {
  const b = {
    select() {
      return b;
    },
    eq() {
      return b;
    },
    is() {
      return b;
    },
    gt() {
      return b;
    },
    update() {
      return b;
    },
    insert() {
      return Promise.resolve(result);
    },
    maybeSingle() {
      return Promise.resolve(result);
    },
    then(onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };
  return b;
}

function scriptedAdmin(scripts: { profiles: QueryResult[]; phone_link_codes: QueryResult[] }): AdminClient {
  const queues = {
    profiles: [...scripts.profiles],
    phone_link_codes: [...scripts.phone_link_codes],
  };
  return {
    from(table: string) {
      const queue = queues[table as keyof typeof queues];
      if (!queue) throw new Error(`unexpected table ${table}`);
      const next = queue.shift();
      if (!next) throw new Error(`unexpected ${table} call`);
      return builder(next);
    },
  } as unknown as AdminClient;
}

describe("consumeLinkCode without a database", () => {
  it("rejects a malformed code without touching the client", async () => {
    const admin = scriptedAdmin({ profiles: [], phone_link_codes: [] });
    const result = await consumeLinkCode(admin, "nope", "+14135550123");
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a malformed number without burning a code", async () => {
    const admin = scriptedAdmin({ profiles: [], phone_link_codes: [] });
    const result = await consumeLinkCode(admin, "ABCDEF", "not-a-phone");
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("treats a unique violation on the phone update as phone_taken", async () => {
    const admin = scriptedAdmin({
      phone_link_codes: [
        { data: { id: "row-1", student_id: "student-1" }, error: null },
        { data: { student_id: "student-1" }, error: null },
      ],
      profiles: [
        { data: null, error: null },
        { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } },
      ],
    });
    const result = await consumeLinkCode(admin, "ABCDEF", "+14135550123");
    expect(result).toEqual({ ok: false, reason: "phone_taken" });
  });

  it("returns invalid when the conditional update loses a race", async () => {
    const admin = scriptedAdmin({
      phone_link_codes: [
        { data: { id: "row-1", student_id: "student-1" }, error: null },
        { data: null, error: null },
      ],
      profiles: [{ data: null, error: null }],
    });
    const result = await consumeLinkCode(admin, "ABCDEF", "+14135550123");
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });
});

describe.skipIf(SKIP_DB_TESTS)("phone link codes", () => {
  let service: SupabaseClient<Database>;
  let anonKey = "";
  let url = "";
  const userIds: string[] = [];
  let studentId = "";
  let otherId = "";
  let studentClient: SupabaseClient<Database>;
  const otherPhone = randomPhone();

  beforeAll(async () => {
    const env = dbEnv();
    url = env.url;
    anonKey = env.anonKey;
    service = client(env.url, env.serviceRoleKey);

    const student = await createThrowaway(service, env.url, env.anonKey, "Link Owner");
    const other = await createThrowaway(service, env.url, env.anonKey, "Link Other");
    studentId = student.id;
    otherId = other.id;
    studentClient = student.client;
    userIds.push(student.id, other.id);

    const { error } = await service.from("profiles").update({ phone: otherPhone }).eq("id", other.id);
    if (error) throw new Error(`could not set the other phone: ${error.message}`);
  });

  afterAll(async () => {
    if (!service) return;
    for (const id of userIds) {
      const { error } = await service.auth.admin.deleteUser(id);
      if (error) console.warn(`cleanup: could not delete ${id}: ${error.message}`);
    }
  });

  async function clearPhone(id: string) {
    const { error } = await service.from("profiles").update({ phone: null }).eq("id", id);
    if (error) throw new Error(`could not clear phone: ${error.message}`);
  }

  async function phoneOf(id: string): Promise<string | null> {
    const { data, error } = await service.from("profiles").select("phone").eq("id", id).single();
    if (error) throw new Error(`could not read phone: ${error.message}`);
    return data.phone;
  }

  it("stores only the hash, and a second issue leaves one unused row", async () => {
    await clearPhone(studentId);
    const first = await createLinkCode(service, studentId);
    expect(first.code).toMatch(LINK_CODE_PATTERN);
    const expiresIn = Date.parse(first.expiresAt) - Date.now();
    expect(expiresIn).toBeGreaterThan(LINK_CODE_TTL_MS - 5_000);
    expect(expiresIn).toBeLessThanOrEqual(LINK_CODE_TTL_MS + 5_000);

    const afterFirst = await listLinkCodes(service, studentId);
    const stored = afterFirst.find((row) => row.code_hash === hashCode(first.code));
    expect(stored).toBeTruthy();
    expect(stored?.code_hash).toBe(hashCode(first.code));
    expect(stored?.code_hash).not.toContain(first.code);
    expect(stored?.used_at).toBeNull();

    const second = await createLinkCode(service, studentId);
    expect(second.code).toMatch(LINK_CODE_PATTERN);
    expect(second.code).not.toBe(first.code);

    const rows = await listLinkCodes(service, studentId);
    const unused = rows.filter((row) => row.used_at === null);
    expect(unused).toHaveLength(1);
    expect(unused[0]?.code_hash).toBe(hashCode(second.code));
    expect(unused[0]?.code_hash).not.toContain(second.code);
    const retired = rows.find((row) => row.code_hash === hashCode(first.code));
    expect(retired?.used_at).toBeTruthy();
  });

  it("sets the phone on consume and rejects a second consume", async () => {
    await clearPhone(studentId);
    const issued = await createLinkCode(service, studentId);
    const phone = randomPhone();
    const consumed = await consumeLinkCode(service, `  ${issued.code.toLowerCase()}  `, phone);
    expect(consumed).toEqual({ ok: true, studentId });
    expect(await phoneOf(studentId)).toBe(phone);

    const rows = await listLinkCodes(service, studentId);
    const row = rows.find((item) => item.code_hash === hashCode(issued.code));
    expect(row?.used_at).toBeTruthy();

    const again = await consumeLinkCode(service, issued.code, randomPhone());
    expect(again).toEqual({ ok: false, reason: "invalid" });
    expect(await phoneOf(studentId)).toBe(phone);
  });

  it("rejects an expired code and a wrong code", async () => {
    await clearPhone(studentId);
    const issued = await createLinkCode(service, studentId);
    await setLinkCodeExpiresAt(service, hashCode(issued.code), new Date(Date.now() - 60_000).toISOString());

    const expired = await consumeLinkCode(service, issued.code, randomPhone());
    expect(expired).toEqual({ ok: false, reason: "invalid" });
    expect(await phoneOf(studentId)).toBeNull();
    const rows = await listLinkCodes(service, studentId);
    expect(rows.find((row) => row.code_hash === hashCode(issued.code))?.used_at).toBeNull();

    const wrong = await consumeLinkCode(service, "ZZZZZZ", randomPhone());
    expect(wrong).toEqual({ ok: false, reason: "invalid" });
    expect(await phoneOf(studentId)).toBeNull();
  });

  it("burns the code when the number belongs to someone else and changes neither phone", async () => {
    await clearPhone(studentId);
    const issued = await createLinkCode(service, studentId);
    const taken = await consumeLinkCode(service, issued.code, otherPhone);
    expect(taken).toEqual({ ok: false, reason: "phone_taken" });

    const rows = await listLinkCodes(service, studentId);
    expect(rows.find((row) => row.code_hash === hashCode(issued.code))?.used_at).toBeTruthy();
    expect(await phoneOf(studentId)).toBeNull();
    expect(await phoneOf(otherId)).toBe(otherPhone);
  });

  it("lets the same student replace their own phone", async () => {
    const previous = randomPhone();
    const next = randomPhone();
    const { error } = await service.from("profiles").update({ phone: previous }).eq("id", studentId);
    if (error) throw new Error(`could not set the current phone: ${error.message}`);

    const issued = await createLinkCode(service, studentId);
    const consumed = await consumeLinkCode(service, issued.code, next);
    expect(consumed).toEqual({ ok: true, studentId });
    expect(await phoneOf(studentId)).toBe(next);
    expect(await phoneOf(otherId)).toBe(otherPhone);

    const rows = await listLinkCodes(service, studentId);
    expect(rows.find((row) => row.code_hash === hashCode(issued.code))?.used_at).toBeTruthy();
  });

  it("does not let an authenticated client select the table", async () => {
    await clearPhone(studentId);
    const issued = await createLinkCode(service, studentId);
    const hash = hashCode(issued.code);
    const result = await selectLinkCodeHashes(studentClient);
    const payload = JSON.stringify(result);
    expect(payload).not.toContain(hash);
    expect(payload).not.toContain(issued.code);
    if (result.error) {
      expect(result.error.code).toBe("42501");
      expect(result.data ?? []).toEqual([]);
    } else {
      expect(result.data ?? []).toEqual([]);
    }

    // The session client used above was created at sign-in. Prove a fresh
    // anon-key client with that session is the same story.
    const authed = client(url, anonKey);
    const { data: sessionData, error: sessionError } = await studentClient.auth.getSession();
    if (sessionError || !sessionData.session) throw new Error("missing session");
    await authed.auth.setSession(sessionData.session);
    const again = await selectLinkCodeHashes(authed);
    expect(JSON.stringify(again)).not.toContain(hash);
    expect(again.error !== null || (again.data ?? []).length === 0).toBe(true);
  });
});

async function createThrowaway(
  service: SupabaseClient<Database>,
  url: string,
  anonKey: string,
  name: string,
): Promise<{ id: string; client: SupabaseClient<Database> }> {
  const email = `link-${randomBytes(8).toString("hex")}@pluto.test`;
  const password = `pw-${randomBytes(12).toString("hex")}`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message ?? "no user"}`);
  try {
    const signedIn = client(url, anonKey);
    const session = await signedIn.auth.signInWithPassword({ email, password });
    if (session.error || !session.data.session) {
      throw new Error(`sign-in failed: ${session.error?.message ?? "no session"}`);
    }
    return { id: data.user.id, client: signedIn };
  } catch (err) {
    await service.auth.admin.deleteUser(data.user.id);
    throw err;
  }
}
