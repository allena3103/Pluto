import type { PlutoDb } from "@pluto/core/context";
import { describe, expect, it, vi } from "vitest";
import { buildPlanRequest, findRecentCrunchAlert, isYesReply, weekEndOf } from "./crunch-plan";
import { processInboundSms, type SmsInboundDeps } from "./sms-inbound";

const STUDENT = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-14T20:00:00Z");

describe("isYesReply", () => {
  it.each([
    "y", "yes", "YES", "Yeah", "yep", "yup", "sure", "ok", "OK.", "okay!", "please", "plan",
    "yes please", "Sure thing", "  yes  ", "yes.", "sure thing!",
  ])("accepts %j", (text) => expect(isYesReply(text)).toBe(true));

  it.each([
    "yes but what about grades", "no", "LINK ABC123", "", "yes!!", "yes yes", "what is the plan", "yesplease", "ok then",
  ])("rejects %j", (text) => expect(isYesReply(text)).toBe(false));
});

describe("buildPlanRequest", () => {
  it("uses the dates from the alert row", () => {
    const request = buildPlanRequest("2026-11-16", NOW)!;
    expect(request).toContain("study plan for the week 2026-11-16 to 2026-11-22");
    expect(request).toContain("get_deadlines");
    expect(request).toContain("search_notes");
    expect(request).toContain("daysAhead 10");
  });
  it("is null for a bad date", () => {
    expect(buildPlanRequest("2026-13-40")).toBeNull();
    expect(buildPlanRequest("tomorrow")).toBeNull();
    expect(weekEndOf("2026-02-30")).toBeNull();
  });
  it("crosses a month end", () => {
    expect(weekEndOf("2026-11-27")).toBe("2026-12-03");
  });
});

function alertAdmin(rows: { data: unknown; error?: { code?: string } | null }) {
  const calls: Array<[string, unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "eq", "not", "order", "limit"]) {
    chain[name] = (...args: unknown[]) => {
      calls.push([name, args]);
      return chain;
    };
  }
  chain.maybeSingle = async () => ({ data: rows.data, error: rows.error ?? null });
  return { admin: { from: () => chain } as unknown as PlutoDb, calls };
}

describe("findRecentCrunchAlert", () => {
  const recent = new Date(NOW.getTime() - 3_600_000).toISOString();
  it("returns a recent alert and filters by student and kind", async () => {
    const { admin, calls } = alertAdmin({ data: { week_start: "2026-11-16", sent_at: recent } });
    expect(await findRecentCrunchAlert(admin, STUDENT, NOW)).toEqual({ weekStart: "2026-11-16", sentAt: recent });
    expect(calls).toContainEqual(["eq", ["student_id", STUDENT]]);
    expect(calls).toContainEqual(["eq", ["kind", "crunch_week"]]);
  });
  it.each([
    ["older than 24 hours", { week_start: "2026-11-16", sent_at: new Date(NOW.getTime() - 25 * 3_600_000).toISOString() }],
    ["no week", { week_start: null, sent_at: recent }],
    ["not sent", { week_start: "2026-11-16", sent_at: null }],
    ["a bad week", { week_start: "soon", sent_at: recent }],
    ["no row", null],
  ])("is null for %s", async (_name, row) => {
    expect(await findRecentCrunchAlert(alertAdmin({ data: row }).admin, STUDENT, NOW)).toBeNull();
  });
  it("is null on a database error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = alertAdmin({ data: null, error: { code: "XX000" } });
    expect(await findRecentCrunchAlert(admin, STUDENT, NOW)).toBeNull();
    spy.mockRestore();
  });
});

describe("processInboundSms yes hook (no database)", () => {
  function setup(alertRow: unknown) {
    const alerts = alertAdmin({ data: alertRow });
    const admin = {
      from(table: string) {
        if (table === "sms_inbound_receipts") return { insert: async () => ({ error: null }) };
        if (table === "alerts") return (alerts.admin as unknown as { from: (t: string) => unknown }).from(table);
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as PlutoDb;
    const runAgent = vi.fn(async (_input: { message: string }) => ({ text: "ok", citations: [] }));
    const deps: SmsInboundDeps = {
      createAdmin: () => admin,
      appUrl: "http://localhost:3603",
      provider: "simulator",
      llm: "mock",
      runAgent: runAgent as unknown as SmsInboundDeps["runAgent"],
      sendSms: vi.fn(async () => ({ ok: true as const, provider: "simulator" as const, id: "m" })),
      recordInboundSms: vi.fn(async () => {}),
      createSmsMagicLink: vi.fn(async () => null),
      findStudentByPhone: vi.fn(async () => ({ studentId: STUDENT, name: "" })),
    };
    return { deps, runAgent };
  }
  const send = (content: string, deps: SmsInboundDeps) =>
    processInboundSms({ from_number: "+15555550100", content, message_handle: `h-${Math.random()}` }, deps);

  it("swaps a yes for the plan request when a fresh alert exists", async () => {
    const { deps, runAgent } = setup({ week_start: "2026-11-16", sent_at: new Date().toISOString() });
    await send("YES", deps);
    expect(runAgent.mock.calls[0]![0].message).toContain("study plan for the week 2026-11-16 to 2026-11-22");
  });
  it("passes anything else through unchanged, without looking up alerts", async () => {
    const { deps, runAgent } = setup({ week_start: "2026-11-16", sent_at: new Date().toISOString() });
    await send("yes but what about grades", deps);
    expect(runAgent.mock.calls[0]![0].message).toBe("yes but what about grades");
  });
  it("passes a yes through unchanged when there is no usable alert", async () => {
    const { deps, runAgent } = setup(null);
    await send("yes", deps);
    expect(runAgent.mock.calls[0]![0].message).toBe("yes");
  });
});
