import type { PlutoDb } from "@pluto/core/context";
import type { CrunchWeek } from "@pluto/core/contract";
import { describe, expect, it, vi } from "vitest";
import { crunchMessage, handleAlertsDemo, studyBlockEndingAt, type AlertsDemoDeps } from "./alerts-demo";
import { feedTokenFromSegment, handleCalFeed } from "./cal-feed";
import { deadlineMessage, handleDeadlineChange, type DeadlineChangeDeps } from "./deadline-change";

// Auth and parsing paths that must never reach the database. DB-backed cases live in alerts-db.test.ts.

const SECRET = "test-internal-secret";
const STUDENT = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
const ASSIGNMENT = "22222222-2222-4222-8222-222222222222";
const APP = "http://localhost:3405";

function post(path: string, body: unknown, secret: string | null): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-internal-secret"] = secret;
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function forbiddenAdmin() {
  return vi.fn((): PlutoDb => {
    throw new Error("admin client must not be built");
  });
}

const changeBody = {
  studentId: STUDENT,
  assignmentId: ASSIGNMENT,
  oldDueAt: "2026-11-18T04:59:00Z",
  newDueAt: "2026-11-20T04:59:00Z",
};

describe("POST /api/alerts/deadline-change auth", () => {
  function deps(overrides: Partial<DeadlineChangeDeps> = {}): DeadlineChangeDeps {
    return { expectedSecret: SECRET, appUrl: APP, provider: "simulator", createAdmin: forbiddenAdmin(), ...overrides };
  }

  it("is 401 with no secret and never builds the admin client", async () => {
    const d = deps();
    const res = await handleDeadlineChange(post("/api/alerts/deadline-change", changeBody, null), d);
    expect(res.status).toBe(401);
    expect(d.createAdmin).not.toHaveBeenCalled();
  });

  it("is 401 with a wrong secret, before reading the body", async () => {
    const d = deps();
    const res = await handleDeadlineChange(post("/api/alerts/deadline-change", "not json", `${SECRET}x`), d);
    expect(res.status).toBe(401);
    expect(d.createAdmin).not.toHaveBeenCalled();
  });

  it("is 401 with an empty secret", async () => {
    const d = deps();
    expect((await handleDeadlineChange(post("/api/alerts/deadline-change", changeBody, ""), d)).status).toBe(401);
    expect(d.createAdmin).not.toHaveBeenCalled();
  });

  it("is 500 when INTERNAL_API_SECRET is unset, even if the caller sends an empty secret", async () => {
    const d = deps({ expectedSecret: undefined });
    expect((await handleDeadlineChange(post("/api/alerts/deadline-change", changeBody, ""), d)).status).toBe(500);
    expect(d.createAdmin).not.toHaveBeenCalled();
  });

  it("is 400 on a bad body without building the admin client", async () => {
    const d = deps();
    expect((await handleDeadlineChange(post("/api/alerts/deadline-change", "not json", SECRET), d)).status).toBe(400);
    expect(
      (await handleDeadlineChange(post("/api/alerts/deadline-change", { ...changeBody, studentId: "x" }, SECRET), d)).status,
    ).toBe(400);
    expect(d.createAdmin).not.toHaveBeenCalled();
  });
});

describe("POST /api/alerts/demo auth", () => {
  function deps(overrides: Partial<AlertsDemoDeps> = {}): AlertsDemoDeps {
    return {
      expectedSecret: SECRET,
      appUrl: APP,
      provider: "simulator",
      getSessionUserId: vi.fn(async () => null),
      createAdmin: forbiddenAdmin(),
      ...overrides,
    };
  }

  it("is 401 with no session and no secret", async () => {
    const d = deps();
    const res = await handleAlertsDemo(post("/api/alerts/demo", { studentId: STUDENT }, null), d);
    expect(res.status).toBe(401);
    expect(d.createAdmin).not.toHaveBeenCalled();
  });

  it("is 401 with a wrong secret and does not fall back to the session", async () => {
    const getSessionUserId = vi.fn(async () => STUDENT);
    const d = deps({ getSessionUserId });
    const res = await handleAlertsDemo(post("/api/alerts/demo", { studentId: STUDENT }, "wrong"), d);
    expect(res.status).toBe(401);
    expect(getSessionUserId).not.toHaveBeenCalled();
    expect(d.createAdmin).not.toHaveBeenCalled();
  });

  it("is 401 when a secret is sent but INTERNAL_API_SECRET is unset", async () => {
    const d = deps({ expectedSecret: undefined });
    expect((await handleAlertsDemo(post("/api/alerts/demo", { studentId: STUDENT }, ""), d)).status).toBe(401);
    expect(d.createAdmin).not.toHaveBeenCalled();
  });

  it("is 403 when the session student is not studentId", async () => {
    const d = deps({ getSessionUserId: vi.fn(async () => OTHER) });
    const res = await handleAlertsDemo(post("/api/alerts/demo", { studentId: STUDENT }, null), d);
    expect(res.status).toBe(403);
    expect(d.createAdmin).not.toHaveBeenCalled();
  });

  it("is 400 on a bad body", async () => {
    const d = deps({ getSessionUserId: vi.fn(async () => STUDENT) });
    expect((await handleAlertsDemo(post("/api/alerts/demo", "nope", null), d)).status).toBe(400);
    expect((await handleAlertsDemo(post("/api/alerts/demo", { studentId: "x" }, null), d)).status).toBe(400);
    expect(d.createAdmin).not.toHaveBeenCalled();
  });
});

describe("GET /cal/<token>.ics parsing", () => {
  it("accepts only <base64url>.ics", () => {
    expect(feedTokenFromSegment("abc_DEF-123.ics")).toBe("abc_DEF-123");
    for (const bad of ["abc", "abc.ICS", ".ics", "abc.ics.ics", "a b.ics", "abc.txt", "../x.ics", "abc%2F.ics"]) {
      expect(feedTokenFromSegment(bad)).toBeNull();
    }
  });

  it("is 404 for a malformed segment without building the admin client", async () => {
    const createAdmin = forbiddenAdmin();
    expect((await handleCalFeed("abc", { createAdmin })).status).toBe(404);
    expect((await handleCalFeed("abc.json", { createAdmin })).status).toBe(404);
    expect(createAdmin).not.toHaveBeenCalled();
  });

  it("is 404 when the token is unknown", async () => {
    const res = await handleCalFeed("unknown.ics", {
      createAdmin: () => ({}) as PlutoDb,
      getCalendarFeed: vi.fn(async () => null),
    });
    expect(res.status).toBe(404);
  });

  it("serves text/calendar for a known token", async () => {
    const res = await handleCalFeed("known.ics", {
      createAdmin: () => ({}) as PlutoDb,
      getCalendarFeed: vi.fn(async () => ({
        studentId: STUDENT,
        alertId: ASSIGNMENT,
        events: [{ id: "b1", title: "Study", start: new Date("2026-11-20T03:29:00Z"), end: new Date("2026-11-20T04:59:00Z") }],
      })),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(await res.text()).toContain("UID:b1@pluto");
  });
});

describe("message helpers", () => {
  it("makes a 90-minute block ending at the due date", () => {
    expect(studyBlockEndingAt("2026-11-20T04:59:00Z")).toEqual({
      startsAt: "2026-11-20T03:29:00.000Z",
      endsAt: "2026-11-20T04:59:00.000Z",
    });
    expect(studyBlockEndingAt("not a date")).toBeNull();
  });

  it("writes the crunch text with the calendar link", () => {
    const week = {
      weekStart: "2026-11-16",
      weekEnd: "2026-11-22",
      deliverableCount: 3,
      totalWeightPercent: 21.5,
      score: 24.5,
      rank: 1,
      assignments: [],
    } as CrunchWeek;
    const url = `${APP}/cal/tok.ics`;
    expect(crunchMessage(week, url)).toBe(
      `Pluto: your heaviest week is Nov 16-Nov 22: 3 things due worth 22% of your grades. ` +
        `I added a 90-minute study block before each. Add them to your calendar: ${url} Want a plan? Reply YES.`,
    );
    const none = crunchMessage(undefined, url);
    expect(none).toContain(url);
    expect(none).not.toMatch(/reply yes/i);
  });

  it("writes the deadline text in Eastern time", () => {
    const text = deadlineMessage({ title: "Essay 2", courseName: "History 105", ...changeBody }, `${APP}/cal/t.ics`);
    expect(text).toBe(
      `Pluto: "Essay 2" (History 105) moved from Tue, Nov 17, 11:59 PM to Thu, Nov 19, 11:59 PM. Updated study block: ${APP}/cal/t.ics`,
    );
  });
});
