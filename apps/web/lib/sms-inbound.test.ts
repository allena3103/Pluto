import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PlutoDb } from "@pluto/core/context";
import type { Database } from "@pluto/core/database.types";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createLinkCode } from "./phone-link";
import {
  LINKED_TEXT,
  LINK_FAILED_TEXT,
  UNKNOWN_NUMBER_TEXT,
  dedupeKey,
  handleSmsWebhook,
  processInboundSms,
  simulateInboundSms,
  type SmsInboundDeps,
  type SmsWebhookDeps,
} from "./sms-inbound";

const SECRET = "test-sendblue-secret";
const APP = "http://localhost:3404";
const STUDENT = "11111111-1111-4111-8111-111111111111";
const FILE = "33333333-3333-4333-8333-333333333333";
const MAGIC = `${APP}/open/tok_abc123`;

// ------------------------------------------------------------------ fakes (no database)

type Row = Record<string, unknown>;

/** Minimal admin stand-in: receipts (with a primary key) and profiles by phone. */
function fakeAdmin(phones: Record<string, string> = {}) {
  const receipts = new Set<string>();
  const tablesTouched: string[] = [];
  const admin = {
    from(table: string) {
      tablesTouched.push(table);
      if (table === "sms_inbound_receipts") {
        return {
          insert: async (row: Row) => {
            const key = String(row.dedupe_key);
            if (receipts.has(key)) return { error: { code: "23505", message: "duplicate" } };
            receipts.add(key);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as PlutoDb;
  const findStudentByPhone = vi.fn(async (_admin: PlutoDb, phone: string) =>
    phones[phone] ? { studentId: phones[phone]!, name: "" } : null,
  );
  return { admin, receipts, tablesTouched, findStudentByPhone };
}

function unitDeps(phones: Record<string, string> = {}, overrides: Partial<SmsInboundDeps> = {}) {
  const fake = fakeAdmin(phones);
  const sendSms = vi.fn(async () => ({ ok: true as const, provider: "simulator" as const, id: "m1" }));
  const recordInboundSms = vi.fn(async () => {});
  const runAgent = vi.fn(async () => ({
    text: "The treaty is on page 3.",
    citations: [{ fileId: FILE, page: 3, deepLink: `${APP}/notes/${FILE}?page=3` }],
  }));
  const createSmsMagicLink = vi.fn(async () => MAGIC);
  const consumeLinkCode = vi.fn(async () => ({ ok: true as const, studentId: STUDENT }));
  const deps: SmsInboundDeps = {
    createAdmin: () => fake.admin,
    appUrl: APP,
    provider: "simulator",
    llm: "mock",
    sendSms,
    recordInboundSms,
    runAgent,
    createSmsMagicLink,
    consumeLinkCode,
    findStudentByPhone: fake.findStudentByPhone,
    ...overrides,
  };
  return { deps, fake, sendSms, recordInboundSms, runAgent, createSmsMagicLink, consumeLinkCode };
}

function webhook(body: unknown, headers: Record<string, string> = { "sb-signing-secret": SECRET }): Request {
  return new Request("http://localhost/api/sms/inbound", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("dedupeKey", () => {
  it("uses the provider message id when there is one", () => {
    expect(dedupeKey({ from_number: "+1", content: "x", message_handle: "ABC" })).toBe("sendblue:ABC");
  });
  it("hashes number and text otherwise", () => {
    const hash = createHash("sha256").update("+14135550100\nhello").digest("hex");
    expect(dedupeKey({ from_number: "+14135550100", content: "hello" })).toBe(`sha256:${hash}`);
  });
});

describe("POST /api/sms/inbound (no database)", () => {
  function webhookDeps(overrides: Partial<SmsWebhookDeps> = {}): SmsWebhookDeps & ReturnType<typeof unitDeps> {
    const u = unitDeps({ "+15555550100": STUDENT });
    return { ...u, ...u.deps, expectedSecret: SECRET, ...overrides };
  }

  it("is 401 with a wrong secret and does no lookup", async () => {
    const createAdmin = vi.fn(() => {
      throw new Error("must not be called");
    });
    const d = webhookDeps({ createAdmin });
    const res = await handleSmsWebhook(webhook({ from_number: "+15555550100", content: "hi" }, { "sb-signing-secret": "nope" }), d);
    expect(res.status).toBe(401);
    expect(createAdmin).not.toHaveBeenCalled();
    expect(d.findStudentByPhone).not.toHaveBeenCalled();
  });

  it("is 401 with no secret header, before reading the body", async () => {
    const createAdmin = vi.fn();
    const res = await handleSmsWebhook(webhook("not json", {}), webhookDeps({ createAdmin }));
    expect(res.status).toBe(401);
    expect(createAdmin).not.toHaveBeenCalled();
  });

  it("is 500 when the secret is not configured", async () => {
    const res = await handleSmsWebhook(webhook({}), webhookDeps({ expectedSecret: undefined }));
    expect(res.status).toBe(500);
  });

  it("is 400 on a bad body", async () => {
    expect((await handleSmsWebhook(webhook("not json"), webhookDeps())).status).toBe(400);
    expect((await handleSmsWebhook(webhook({ content: "hi" }), webhookDeps())).status).toBe(400);
  });

  it("answers a linked number once, even when delivered twice", async () => {
    const d = webhookDeps();
    const payload = { from_number: "+15555550100", content: "treaty notes?", message_handle: "H-1", extra: 1 };
    const first = await handleSmsWebhook(webhook(payload), d);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    const second = await handleSmsWebhook(webhook(payload), d);
    expect(await second.json()).toEqual({ ok: true });
    expect(d.runAgent).toHaveBeenCalledTimes(1);
    expect(d.sendSms).toHaveBeenCalledTimes(1);
    const sent = d.sendSms.mock.calls[0] as unknown as [unknown, { studentId: string; to: string; body: string }];
    expect(sent[1].studentId).toBe(STUDENT);
    expect(sent[1].body.endsWith(MAGIC)).toBe(true);
  });

  it("accepts the alternate secret header name", async () => {
    const res = await handleSmsWebhook(webhook({ from_number: "+15555550100", content: "hi" }, { "sb-webhook-secret": SECRET }), webhookDeps());
    expect(res.status).toBe(200);
  });

  it("ignores outbound status events", async () => {
    const d = webhookDeps();
    await handleSmsWebhook(webhook({ from_number: "+15555550100", content: "x", is_outbound: true }), d);
    expect(d.runAgent).not.toHaveBeenCalled();
    expect(d.sendSms).not.toHaveBeenCalled();
  });
});

describe("processInboundSms (no database)", () => {
  it("unknown number gets the fixed reply, no record, no agent", async () => {
    const u = unitDeps();
    const result = await processInboundSms({ from_number: "+14135550199", content: "hi" }, u.deps);
    expect(result).toMatchObject({ outcome: "unknown_number", reply: UNKNOWN_NUMBER_TEXT });
    expect(u.recordInboundSms).not.toHaveBeenCalled();
    expect(u.sendSms).not.toHaveBeenCalled();
    expect(u.runAgent).not.toHaveBeenCalled();
  });

  it("unknown number with sendblue replies through the API and stores nothing", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const u = unitDeps(
      {},
      {
        provider: "sendblue",
        fetch: fetchImpl as unknown as typeof fetch,
        env: { SENDBLUE_API_KEY_ID: "k", SENDBLUE_API_SECRET: "s", SENDBLUE_FROM_NUMBER: "+15550000000" },
      },
    );
    const result = await processInboundSms({ from_number: "+14135550199", content: "hi" }, u.deps);
    expect(result.sent).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(u.recordInboundSms).not.toHaveBeenCalled();
  });

  it("LINK calls consumeLinkCode and confirms, without the agent", async () => {
    const u = unitDeps();
    const result = await processInboundSms({ from_number: "(413) 555-0177", content: " link abc234 " }, u.deps);
    expect(u.consumeLinkCode).toHaveBeenCalledWith(expect.anything(), "abc234", "+14135550177");
    expect(result).toMatchObject({ outcome: "linked", reply: LINKED_TEXT, studentId: STUDENT });
    expect(u.runAgent).not.toHaveBeenCalled();
    const recorded = u.recordInboundSms.mock.calls[0] as unknown as [unknown, { body: string }];
    expect(recorded[1].body).not.toContain("abc234");
  });

  it("a failed LINK gets the fixed sentence", async () => {
    const u = unitDeps({}, { consumeLinkCode: vi.fn(async () => ({ ok: false as const, reason: "phone_taken" as const })) });
    const result = await processInboundSms({ from_number: "+14135550177", content: "LINK ABC234" }, u.deps);
    expect(result).toMatchObject({ outcome: "link_failed", reply: LINK_FAILED_TEXT });
    expect(u.sendSms).not.toHaveBeenCalled();
  });
});

describe("simulateInboundSms (no database)", () => {
  it("refuses a real-looking number", async () => {
    const u = unitDeps();
    const result = await simulateInboundSms({ viewerId: STUDENT, fromNumber: "+14132221234", content: "hi" }, u.deps);
    expect(result.ok).toBe(false);
    expect(u.runAgent).not.toHaveBeenCalled();
  });

  it("refuses another student's number", async () => {
    const u = unitDeps({ "+15555550101": "someone-else" });
    const result = await simulateInboundSms({ viewerId: STUDENT, fromNumber: "+15555550101", content: "hi" }, u.deps);
    expect(result).toEqual({ ok: false, error: "That number belongs to another student." });
    expect(u.runAgent).not.toHaveBeenCalled();
  });

  it("forces the simulator provider and does not echo stored replies", async () => {
    const u = unitDeps({ "+15555550100": STUDENT }, { provider: "sendblue" } as Partial<SmsInboundDeps>);
    const result = await simulateInboundSms({ viewerId: STUDENT, fromNumber: "+15555550100", content: "hi" }, u.deps);
    expect(result).toEqual({ ok: true, outcome: "answered" });
    const call = u.sendSms.mock.calls[0] as unknown as [{ provider: string }];
    expect(call[0].provider).toBe("simulator");
  });

  it("shows the fixed reply for an unlinked test number", async () => {
    const u = unitDeps();
    const result = await simulateInboundSms({ viewerId: STUDENT, fromNumber: "+14135550142", content: "hi" }, u.deps);
    expect(result).toEqual({ ok: true, outcome: "unknown_number", reply: UNKNOWN_NUMBER_TEXT });
  });
});

// ------------------------------------------------------------------ local Supabase

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY
) {
  if (existsSync(envFile)) config({ path: envFile, quiet: true });
}
const SKIP_DB_TESTS = process.env.PLUTO_SKIP_DB_TESTS === "1";
const HTTP_TIMEOUT_MS = 20_000;
const DEMO_STUDENT_ID = "11111111-1111-4111-8111-111111111111";

function dbEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("DB tests need local Supabase env. Run `npm run env:local` (or set PLUTO_SKIP_DB_TESTS=1).");
  }
  return { url, anonKey, serviceRoleKey };
}

function client(url: string, key: string): SupabaseClient<Database> {
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS) }),
    },
  });
}

/** Unused 555 number, so it can never collide with a real phone. */
function testPhone(): string {
  const n = randomBytes(4).readUInt32BE(0) % 10_000;
  return `+1413555${String(n).padStart(4, "0")}`;
}

describe.skipIf(SKIP_DB_TESTS)("sms inbound with the local stack", () => {
  let service: SupabaseClient<Database>;
  let anonKey = "";
  let url = "";
  const userIds: string[] = [];
  const demoSmsIds: string[] = [];
  let since = "";

  function dbDeps(): SmsInboundDeps {
    return { createAdmin: () => service, appUrl: APP, provider: "simulator", llm: "mock" };
  }

  beforeAll(async () => {
    const env = dbEnv();
    url = env.url;
    anonKey = env.anonKey;
    service = client(env.url, env.serviceRoleKey);
    since = new Date(Date.now() - 1000).toISOString();
  });

  afterAll(async () => {
    if (!service) return;
    if (demoSmsIds.length) await service.from("sms_messages").delete().in("id", demoSmsIds);
    await service.from("magic_links").delete().eq("student_id", DEMO_STUDENT_ID).gte("created_at", since);
    for (const id of userIds) await service.auth.admin.deleteUser(id);
  });

  async function throwaway(name: string) {
    const email = `sms-${randomBytes(8).toString("hex")}@pluto.test`;
    const password = `pw-${randomBytes(12).toString("hex")}`;
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message ?? "no user"}`);
    userIds.push(data.user.id);
    const signedIn = client(url, anonKey);
    const session = await signedIn.auth.signInWithPassword({ email, password });
    if (session.error) throw new Error(`sign-in failed: ${session.error.message}`);
    return { id: data.user.id, client: signedIn };
  }

  it("a signed-in student cannot read receipts", async () => {
    const user = await throwaway("SMS Reader");
    const res = await (user.client as unknown as SupabaseClient).from("sms_inbound_receipts").select("*");
    expect(res.data ?? []).toEqual([]);
  });

  it("LINK <code> sets profiles.phone and confirms; a duplicate does nothing", async () => {
    const user = await throwaway("SMS Linker");
    const phone = testPhone();
    const { code } = await createLinkCode(service, user.id);
    const payload = { from_number: phone, content: `LINK ${code}`, message_handle: `t-${randomBytes(6).toString("hex")}` };

    const first = await processInboundSms(payload, dbDeps());
    expect(first).toMatchObject({ outcome: "linked", studentId: user.id, sent: true });
    const profile = await service.from("profiles").select("phone").eq("id", user.id).single();
    expect(profile.data?.phone).toBe(phone);

    const again = await processInboundSms(payload, dbDeps());
    expect(again.outcome).toBe("duplicate");
    const out = await service.from("sms_messages").select("body,direction").eq("student_id", user.id);
    expect(out.data?.filter((r) => r.direction === "outbound").map((r) => r.body)).toEqual([LINKED_TEXT]);
  });

  it("an unknown number creates no profile and no sms_messages row", async () => {
    const phone = testPhone();
    const result = await processInboundSms({ from_number: phone, content: "what is due?" }, dbDeps());
    expect(result.outcome).toBe("unknown_number");
    const profiles = await service.from("profiles").select("id").eq("phone", phone);
    expect(profiles.data).toEqual([]);
    const rows = await service.from("sms_messages").select("id").eq("phone", phone);
    expect(rows.data).toEqual([]);
  });

  it("a linked-number question stores an outbound reply ending in an /open/ URL", async () => {
    const demo = await service.from("profiles").select("phone").eq("id", DEMO_STUDENT_ID).single();
    const phone = demo.data?.phone;
    expect(phone, "seeded demo phone").toBeTruthy();

    const result = await processInboundSms(
      { from_number: phone!, content: "Peace of Augsburg", message_handle: `t-${randomBytes(6).toString("hex")}` },
      dbDeps(),
    );
    expect(result.outcome).toBe("answered");
    const rows = await service
      .from("sms_messages")
      .select("id,body,direction")
      .eq("student_id", DEMO_STUDENT_ID)
      .gte("created_at", since)
      .order("created_at", { ascending: true });
    demoSmsIds.push(...(rows.data ?? []).map((r) => r.id));
    const outbound = (rows.data ?? []).filter((r) => r.direction === "outbound");
    expect(outbound.length).toBeGreaterThanOrEqual(1);
    expect(outbound.at(-1)!.body).toMatch(/\/open\/[A-Za-z0-9_-]+$/);
  });
});
