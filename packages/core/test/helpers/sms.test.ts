import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PlutoDb } from "../../src/context";
import { findStudentByPhone, normalizePhone, recordInboundSms, sendSms } from "../../src/sms";
import { SKIP_DB_TESTS } from "../db-env";
import { createThrowawayUser, deleteUsers, serviceClient, type TestUser } from "../db/helpers";

const SENDBLUE_ENV = {
  SENDBLUE_API_KEY_ID: "key-id",
  SENDBLUE_API_SECRET: "secret",
  SENDBLUE_FROM_NUMBER: "+15557654321",
} as NodeJS.ProcessEnv;

interface LoggedSms {
  student_id: string;
  direction: string;
  body: string;
  phone: string;
  provider: string;
}

function spyAdmin(result: { data: { id: string } | null; error: { message: string } | null }): {
  admin: PlutoDb;
  rows: LoggedSms[];
} {
  const rows: LoggedSms[] = [];
  const query = {
    insert(row: LoggedSms) {
      rows.push(row);
      return query;
    },
    select() {
      return query;
    },
    async single() {
      return result;
    },
  };
  return {
    admin: {
      from(table: string) {
        if (table !== "sms_messages") throw new Error(`unexpected table ${table}`);
        return query;
      },
    } as unknown as PlutoDb,
    rows,
  };
}

describe("sendSms sendblue logging", () => {
  it("does not log a failed send", async () => {
    const { admin, rows } = spyAdmin({ data: { id: "should-not-insert" }, error: null });
    const result = await sendSms(
      {
        admin,
        provider: "sendblue",
        env: SENDBLUE_ENV,
        fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response("bad", { status: 500 })),
      },
      { studentId: "student-1", to: "+15551234567", body: "nope" },
    );

    expect(result).toEqual({ ok: false, provider: "sendblue", error: "Sendblue request failed (500)" });
    expect(rows).toEqual([]);
  });

  it("returns success when the text was delivered but the log insert fails", async () => {
    const { admin, rows } = spyAdmin({ data: null, error: { message: "db down" } });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "sb-delivered" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await sendSms(
      { admin, provider: "sendblue", env: SENDBLUE_ENV, fetch: fetchImpl },
      { studentId: "student-1", to: "+15551234567", body: "already sent" },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, provider: "sendblue", id: "sb-delivered" });
    expect(rows).toEqual([
      {
        student_id: "student-1",
        direction: "outbound",
        body: "already sent",
        phone: "+15551234567",
        provider: "sendblue",
      },
    ]);
  });
});

describe.skipIf(SKIP_DB_TESTS)("sms helpers", () => {
  let admin: PlutoDb;
  const users: Array<TestUser | undefined> = [];

  beforeAll(() => {
    admin = serviceClient() as unknown as PlutoDb;
  });

  afterAll(async () => {
    await deleteUsers(admin, users);
  });

  it("simulator provider writes an outbound sms row", async () => {
    const user = await createThrowawayUser(admin, "SMS Simulator");
    users.push(user);

    const result = await sendSms(
      { admin, provider: "simulator" },
      { studentId: user.id, to: "+15551234567", body: "hello simulator" },
    );

    expect(result).toEqual({ ok: true, provider: "simulator", id: expect.any(String) });
    const { data, error } = await admin
      .from("sms_messages")
      .select("direction,body,phone,provider")
      .eq("id", (result as { ok: true; id: string }).id)
      .single();
    if (error || !data) throw new Error(`failed to read sms row: ${error?.message ?? "no data"}`);
    expect(data).toMatchObject({
      direction: "outbound",
      body: "hello simulator",
      phone: "+15551234567",
      provider: "simulator",
    });
  });

  it("sendblue uses the expected endpoint, headers and payload", async () => {
    const user = await createThrowawayUser(admin, "SMS Sendblue");
    users.push(user);

    const fakeFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "sb-msg-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await sendSms(
      {
        admin,
        provider: "sendblue",
        env: {
          SENDBLUE_API_KEY_ID: "key-id",
          SENDBLUE_API_SECRET: "secret",
          SENDBLUE_FROM_NUMBER: "+15557654321",
        } as NodeJS.ProcessEnv,
        fetch: fakeFetch,
      },
      { studentId: user.id, to: "+15551234567", body: "hello sendblue" },
    );

    expect(result).toEqual({ ok: true, provider: "sendblue", id: "sb-msg-1" });
    const { data: logged, error: loggedError } = await admin
      .from("sms_messages")
      .select("direction,body,phone,provider")
      .eq("student_id", user.id)
      .eq("body", "hello sendblue")
      .single();
    if (loggedError || !logged) throw new Error(`failed to read sendblue log: ${loggedError?.message ?? "no data"}`);
    expect(logged).toMatchObject({
      direction: "outbound",
      body: "hello sendblue",
      phone: "+15551234567",
      provider: "sendblue",
    });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const call = fakeFetch.mock.calls[0];
    if (!call) throw new Error("expected one fetch call");
    const [url, init] = call;
    expect(url).toBe("https://api.sendblue.co/api/send-message");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "content-type": "application/json",
      "sb-api-key-id": "key-id",
      "sb-api-secret-key": "secret",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      number: "+15551234567",
      from_number: "+15557654321",
      content: "hello sendblue",
    });
  });

  it("sendblue returns ok:false on 500, network error, timeout and missing env", async () => {
    const user = await createThrowawayUser(admin, "SMS Errors");
    users.push(user);

    const base = { studentId: user.id, to: "+15550000000", body: "hi" };
    const env = {
      SENDBLUE_API_KEY_ID: "key-id",
      SENDBLUE_API_SECRET: "secret",
      SENDBLUE_FROM_NUMBER: "+15557654321",
    } as NodeJS.ProcessEnv;

    const serverError = await sendSms(
      { admin, provider: "sendblue", env, fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response("bad", { status: 500 })) },
      base,
    );
    expect(serverError).toEqual({ ok: false, provider: "sendblue", error: "Sendblue request failed (500)" });

    const networkError = await sendSms(
      {
        admin,
        provider: "sendblue",
        env,
        fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error("network down")),
      },
      base,
    );
    expect(networkError).toEqual({ ok: false, provider: "sendblue", error: "network down" });

    const timeout = Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });
    const timeoutError = await sendSms(
      { admin, provider: "sendblue", env, fetch: vi.fn<typeof fetch>().mockRejectedValue(timeout) },
      base,
    );
    expect(timeoutError).toEqual({ ok: false, provider: "sendblue", error: "request timed out" });

    const missingEnv = await sendSms({ admin, provider: "sendblue", env: {} as NodeJS.ProcessEnv }, base);
    expect(missingEnv).toEqual({
      ok: false,
      provider: "sendblue",
      error: "missing Sendblue env: SENDBLUE_API_KEY_ID, SENDBLUE_API_SECRET, SENDBLUE_FROM_NUMBER",
    });

    const { count, error: countError } = await admin
      .from("sms_messages")
      .select("id", { count: "exact", head: true })
      .eq("student_id", user.id);
    if (countError) throw new Error(`failed to count sms rows: ${countError.message}`);
    expect(count).toBe(0);
  });

  it("reports success when Sendblue delivered but saving the log row fails", async () => {
    const fakeFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "sb-delivered" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await sendSms(
      { admin, provider: "sendblue", env: SENDBLUE_ENV, fetch: fakeFetch },
      { studentId: "00000000-0000-0000-0000-000000000000", to: "+15551234567", body: "already sent" },
    );

    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, provider: "sendblue", id: "sb-delivered" });
  });

  it("records inbound messages", async () => {
    const user = await createThrowawayUser(admin, "SMS Inbound");
    users.push(user);

    await recordInboundSms(admin, {
      studentId: user.id,
      from: "+15551112222",
      body: "incoming",
      provider: "sendblue",
    });

    const { data, error } = await admin
      .from("sms_messages")
      .select("direction,phone,body,provider")
      .eq("student_id", user.id)
      .eq("direction", "inbound")
      .eq("phone", "+15551112222")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (error || !data) throw new Error(`failed to read inbound row: ${error?.message ?? "no data"}`);
    expect(data).toMatchObject({ direction: "inbound", body: "incoming", provider: "sendblue" });
  });

  it("normalizes phone formats and finds matching students", async () => {
    expect(normalizePhone(" (555) 123-4567 ")).toBe("+15551234567");
    expect(normalizePhone("1-555-123-4567")).toBe("+15551234567");
    expect(normalizePhone("+1 (555) 123 4567")).toBe("+15551234567");
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();

    const user = await createThrowawayUser(admin, "Phone Lookup");
    users.push(user);
    const { error } = await admin.from("profiles").update({ phone: "+15556667777", name: "Lookup Student" }).eq("id", user.id);
    if (error) throw new Error(`failed to set phone: ${error.message}`);

    const found = await findStudentByPhone(admin, "(555) 666-7777");
    expect(found).toEqual({ studentId: user.id, name: "Lookup Student" });

    const missing = await findStudentByPhone(admin, "+15550009999");
    expect(missing).toBeNull();
  });
});
