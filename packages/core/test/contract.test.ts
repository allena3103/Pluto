import { describe, expect, expectTypeOf, test } from "vitest";
import type { z } from "zod";
import {
  AlertKind,
  CAL_FEED_RESPONSE,
  CHAT_STREAM_CONTENT_TYPE,
  Channel,
  ChatStreamEvent,
  DeadlineStatus,
  ENDPOINTS,
  ENDPOINT_NAMES,
  FileSource,
  INTERNAL_SECRET_HEADER,
  IngestStatus,
  LlmMode,
  OPEN_RESPONSE,
  RECENT_NOTES_TEXT_CAP_CHARS,
  SmsDirection,
  TOOLS,
  TOOL_NAMES,
  type EndpointName,
  type EndpointRequest,
  type EndpointResponse,
  type ToolArgs,
  type ToolInput,
  type ToolName,
  type ToolOutput,
} from "../src/contract";
import { noteUrl } from "../src/deep-links";

const APP = "http://localhost:3000";
const STUDENT = "11111111-1111-4111-8111-111111111111";
const COURSE = "22222222-2222-4222-8222-222222222222";
const FILE = "33333333-3333-4333-8333-333333333333";
const ASSIGNMENT = "44444444-4444-4444-8444-444444444444";
const ALERT = "55555555-5555-4555-8555-555555555555";
const SESSION = "66666666-6666-4666-8666-666666666666";
/** Fixed seed-style id (not a valid RFC version); must still be accepted. */
const SEED_ID = "00000000-0000-0000-0000-000000000001";
const T1 = "2026-11-10T14:00:00Z";
const T2 = "2026-11-20T23:59:00-05:00";

const page = (n: number) => ({ page: n, text: `Page ${n} text`, deepLink: noteUrl(APP, FILE, n) });
const course = { courseId: COURSE, name: "History 105", term: "Fall 2026" };
const deadline = {
  assignmentId: ASSIGNMENT,
  courseId: COURSE,
  courseName: "History 105",
  title: "Essay 2",
  dueAt: T2,
  previousDueAt: null,
  points: 100,
  weightGroup: "Essays",
  status: "upcoming",
};

type Case = { valid: unknown; expected?: unknown; invalid: unknown[] };

const toolCases: Record<ToolName, { input: Case; output: Case }> = {
  list_courses: {
    input: { valid: {}, expected: {}, invalid: [null, "history"] },
    output: {
      valid: { courses: [course, { ...course, courseId: SEED_ID, term: null }] },
      invalid: [[course], { courses: [{ ...course, courseId: "not-a-uuid" }] }, { courses: [{ courseId: COURSE }] }],
    },
  },
  get_recent_notes: {
    input: {
      valid: { course: "history 105" },
      expected: { course: "history 105", days: 14 },
      invalid: [{}, { course: "" }, { course: "History 105", days: 0 }, { course: "History 105", days: 1.5 }, { course: "History 105", days: 1000 }],
    },
    output: {
      valid: {
        course,
        files: [
          {
            fileId: FILE,
            title: "Lecture 17: The Marshall Plan",
            weekLabel: "Week 9",
            addedAt: T1,
            pageCount: 3,
            pagesIncluded: 2,
            deepLink: noteUrl(APP, FILE, 1),
            pages: [page(1), page(2)],
          },
        ],
        truncated: true,
      },
      invalid: [
        { course, files: [] },
        { course, truncated: false, files: [{ fileId: FILE, title: "x", weekLabel: null, addedAt: T1, pageCount: 1, pagesIncluded: 1, deepLink: noteUrl(APP, FILE, 1), pages: [{ ...page(1), page: 0 }] }] },
        { course, truncated: false, files: [{ fileId: FILE, title: "x", weekLabel: null, addedAt: "2026-11-10", pageCount: 1, pagesIncluded: 1, deepLink: noteUrl(APP, FILE, 1), pages: [] }] },
        { course, truncated: false, files: [{ fileId: FILE, title: "x", weekLabel: null, addedAt: T1, pageCount: 1, pagesIncluded: 1, deepLink: "/notes/relative", pages: [] }] },
      ],
    },
  },
  get_note_pages: {
    input: {
      valid: { fileId: FILE, firstPage: 3, lastPage: 5 },
      expected: { fileId: FILE, firstPage: 3, lastPage: 5 },
      invalid: [{}, { fileId: "nope" }, { fileId: FILE, firstPage: 0 }, { fileId: FILE, lastPage: 2.5 }, { fileId: FILE, firstPage: 5, lastPage: 3 }],
    },
    output: {
      valid: { fileId: FILE, title: "Lecture 17", courseId: COURSE, courseName: "History 105", pageCount: 9, deepLink: noteUrl(APP, FILE, 3), pages: [page(3), page(4)], truncated: false },
      invalid: [
        { fileId: FILE, title: "Lecture 17", courseId: COURSE, courseName: "History 105", pageCount: 9, deepLink: noteUrl(APP, FILE, 3), pages: [page(3)] },
        { fileId: FILE, title: "Lecture 17", courseId: COURSE, courseName: "History 105", pageCount: 9, deepLink: noteUrl(APP, FILE, 3), pages: [{ page: 0, text: "", deepLink: noteUrl(APP, FILE, 1) }], truncated: false },
      ],
    },
  },
  search_notes: {
    input: {
      valid: { query: "  marshall plan " },
      expected: { query: "marshall plan", limit: 10 },
      invalid: [{}, { query: "" }, { query: "   " }, { query: "x", limit: 0 }, { query: "x", limit: 51 }, { query: "x", course: 5 }],
    },
    output: {
      valid: {
        results: [
          { fileId: FILE, title: "Lecture 17", courseId: COURSE, courseName: "History 105", weekLabel: null, page: 4, snippet: "...the Marshall Plan...", deepLink: noteUrl(APP, FILE, 4) },
        ],
      },
      invalid: [
        { results: [{ fileId: FILE, title: "Lecture 17", courseId: COURSE, courseName: "History 105", weekLabel: null, page: 0, snippet: "", deepLink: noteUrl(APP, FILE, 1) }] },
        { results: [{ fileId: FILE, title: "Lecture 17", courseId: COURSE, courseName: "History 105", weekLabel: null, page: 4, snippet: "" }] },
      ],
    },
  },
  get_deadlines: {
    input: {
      valid: {},
      expected: { daysAhead: 30 },
      invalid: [{ daysAhead: 0 }, { daysAhead: 366 }, { daysAhead: "30" }, { course: "" }],
    },
    output: {
      valid: { deadlines: [deadline, { ...deadline, previousDueAt: T1, points: null, weightGroup: null, status: "overdue" }] },
      invalid: [
        { deadlines: [{ ...deadline, status: "late" }] },
        { deadlines: [{ ...deadline, dueAt: "2026-11-20 23:59" }] },
        { deadlines: [{ ...deadline, assignmentId: "a1" }] },
        { deadlines: [{ ...deadline, previousDueAt: undefined }] },
      ],
    },
  },
  get_grades: {
    input: {
      valid: { course: COURSE },
      expected: { course: COURSE },
      invalid: [{ course: "" }, { course: 105 }],
    },
    output: {
      valid: {
        courses: [
          {
            courseId: COURSE,
            courseName: "History 105",
            groups: [
              { name: "Essays", weightPercent: 40, scorePercent: 88.5, gradedCount: 2, ungradedCount: 1 },
              { name: "Final", weightPercent: 60, scorePercent: null, gradedCount: 0, ungradedCount: 1 },
            ],
            weightedGradePercent: 88.5,
            ungradedCount: 2,
          },
        ],
      },
      invalid: [
        { courses: [{ courseId: COURSE, courseName: "History 105", groups: [], ungradedCount: 0 }] },
        { courses: [{ courseId: COURSE, courseName: "History 105", groups: [{ name: "Essays", weightPercent: 140, scorePercent: 1, gradedCount: 1, ungradedCount: 0 }], weightedGradePercent: null, ungradedCount: 0 }] },
        { courses: [{ courseId: COURSE, courseName: "History 105", groups: [{ name: "Essays", weightPercent: 40, scorePercent: 1, gradedCount: 1.5, ungradedCount: 0 }], weightedGradePercent: null, ungradedCount: 0 }] },
      ],
    },
  },
  get_crunch_weeks: {
    input: {
      valid: {},
      expected: { weeksAhead: 8 },
      invalid: [{ weeksAhead: 0 }, { weeksAhead: 27 }, { weeksAhead: 2.5 }],
    },
    output: {
      valid: {
        weeks: [
          { weekStart: "2026-11-16", weekEnd: "2026-11-22", deliverableCount: 1, totalWeightPercent: 20, score: 3.5, rank: 1, assignments: [deadline] },
        ],
      },
      invalid: [
        { weeks: [{ weekStart: "2026-11-16T00:00:00Z", weekEnd: "2026-11-22", deliverableCount: 1, totalWeightPercent: 20, score: 3.5, rank: 1, assignments: [] }] },
        { weeks: [{ weekStart: "2026-11-16", weekEnd: "2026-11-22", deliverableCount: 1, totalWeightPercent: 20, score: 3.5, rank: 0, assignments: [] }] },
        { weeks: [{ weekStart: "2026-11-16", weekEnd: "2026-11-22", deliverableCount: 1, totalWeightPercent: 20, score: 3.5, rank: 1 }] },
      ],
    },
  },
};

const alertResponse: Case = {
  valid: { alertId: ALERT, sent: true, calendarUrl: `${APP}/cal/abc123.ics` },
  invalid: [{ alertId: ALERT, sent: true }, { alertId: "x", sent: true, calendarUrl: `${APP}/cal/abc123.ics` }, { alertId: ALERT, sent: "yes", calendarUrl: `${APP}/cal/abc123.ics` }],
};

const endpointCases: Record<EndpointName, { request: Case; response: Case | null }> = {
  ingest: {
    request: { valid: { fileId: FILE }, expected: { fileId: FILE }, invalid: [{}, { fileId: "f1" }] },
    response: {
      valid: { fileId: FILE, status: "ready", pageCount: 12 },
      invalid: [{ fileId: FILE, status: "done" }, { fileId: FILE }, { fileId: FILE, status: "ready", pageCount: -1 }],
    },
  },
  chat: {
    request: {
      valid: { message: "What did we cover on the Marshall Plan?" },
      expected: { message: "What did we cover on the Marshall Plan?" },
      invalid: [{}, { message: "" }, { message: "hi", sessionId: "nope" }],
    },
    response: {
      valid: { type: "citation", fileId: FILE, page: 4, deepLink: noteUrl(APP, FILE, 4) },
      invalid: [{ type: "citation", fileId: FILE, page: 0, deepLink: noteUrl(APP, FILE, 1) }, { type: "tool", name: "x" }, { type: "text" }, { type: "done" }],
    },
  },
  agentReply: {
    request: {
      valid: { studentId: STUDENT, text: "when is my essay due", channel: "sms" },
      expected: { studentId: STUDENT, text: "when is my essay due", channel: "sms" },
      invalid: [{ studentId: STUDENT, text: "hi", channel: "email" }, { studentId: "s", text: "hi", channel: "web" }, { studentId: STUDENT, channel: "web" }],
    },
    response: {
      valid: { text: "Essay 2 is due Nov 20.", deepLink: `${APP}/open/tok_abc` },
      invalid: [{}, { text: "ok", deepLink: "not a url" }],
    },
  },
  grades: {
    request: { valid: {}, expected: {}, invalid: [{ course: "" }] },
    response: toolCases.get_grades.output,
  },
  magicLink: {
    request: {
      valid: { studentId: STUDENT, fileId: FILE, page: 1 },
      expected: { studentId: STUDENT, fileId: FILE, page: 1 },
      invalid: [{ studentId: STUDENT, fileId: FILE, page: 0 }, { studentId: STUDENT, fileId: FILE, page: 1.5 }, { studentId: STUDENT, fileId: FILE }, { studentId: STUDENT, fileId: "f", page: 1 }],
    },
    response: {
      valid: { url: `${APP}/open/tok_abc`, expiresAt: T1 },
      invalid: [{ url: `${APP}/open/tok_abc` }, { url: "/open/tok_abc", expiresAt: T1 }, { url: `${APP}/open/tok_abc`, expiresAt: "soon" }],
    },
  },
  open: {
    request: { valid: { token: "tok_abc" }, expected: { token: "tok_abc" }, invalid: [{}, { token: "" }] },
    response: null,
  },
  smsInbound: {
    request: {
      valid: { from_number: "+14135550123", content: "when is my essay due", is_outbound: false, message_handle: "abc" },
      expected: { from_number: "+14135550123", content: "when is my essay due", is_outbound: false, message_handle: "abc" },
      invalid: [{ content: "hi" }, { from_number: "+14135550123" }, { from_number: "", content: "hi" }, { from_number: 14135550123, content: "hi" }],
    },
    response: { valid: { ok: true }, invalid: [{}, { ok: "yes" }] },
  },
  alertsDemo: {
    request: { valid: { studentId: STUDENT }, expected: { studentId: STUDENT }, invalid: [{}, { studentId: "demo" }] },
    response: alertResponse,
  },
  calFeed: {
    request: { valid: { token: "feed_abc" }, expected: { token: "feed_abc" }, invalid: [{}, { token: "" }] },
    response: null,
  },
  alertsDeadlineChange: {
    request: {
      valid: { studentId: STUDENT, assignmentId: ASSIGNMENT, oldDueAt: T1, newDueAt: T2 },
      expected: { studentId: STUDENT, assignmentId: ASSIGNMENT, oldDueAt: T1, newDueAt: T2 },
      invalid: [
        { studentId: STUDENT, assignmentId: ASSIGNMENT, oldDueAt: T1 },
        { studentId: STUDENT, assignmentId: ASSIGNMENT, oldDueAt: "2026-11-10", newDueAt: T2 },
        { studentId: STUDENT, assignmentId: "a", oldDueAt: T1, newDueAt: T2 },
      ],
    },
    response: alertResponse,
  },
};

function check(schema: z.ZodType, c: Case) {
  const parsed = schema.safeParse(c.valid);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  if (c.expected !== undefined) expect(parsed.data).toEqual(c.expected);
  expect(c.invalid.length).toBeGreaterThan(0);
  for (const bad of c.invalid) {
    expect(schema.safeParse(bad).success, `should reject ${JSON.stringify(bad)}`).toBe(false);
  }
}

describe("TOOLS", () => {
  test("has exactly the 7 tool names from the plan", () => {
    expect(Object.keys(TOOLS).sort()).toEqual(
      ["get_crunch_weeks", "get_deadlines", "get_grades", "get_note_pages", "get_recent_notes", "list_courses", "search_notes"],
    );
    expect(TOOL_NAMES).toHaveLength(7);
  });

  test.each(TOOL_NAMES)("%s: name matches its key and the description says read-only", (name) => {
    expect(TOOLS[name].name).toBe(name);
    expect(TOOLS[name].description).toMatch(/read-only/i);
    expect(TOOLS[name].description.length).toBeGreaterThan(40);
    expect(TOOLS[name].description).not.toMatch(/anthropic|claude/i);
  });

  test.each(TOOL_NAMES)("%s: input accepts a valid example, applies defaults, rejects bad ones", (name) => {
    check(TOOLS[name].input, toolCases[name].input);
  });

  test.each(TOOL_NAMES)("%s: output accepts a valid example and rejects bad ones", (name) => {
    check(TOOLS[name].output, toolCases[name].output);
  });

  test("defaults and bounds from the plan", () => {
    expect(TOOLS.get_recent_notes.input.parse({ course: "x" }).days).toBe(14);
    expect(TOOLS.get_deadlines.input.parse({}).daysAhead).toBe(30);
    expect(TOOLS.get_crunch_weeks.input.parse({}).weeksAhead).toBe(8);
    expect(TOOLS.search_notes.input.parse({ query: "x" }).limit).toBe(10);
    expect(TOOLS.search_notes.input.safeParse({ query: "x", limit: 50 }).success).toBe(true);
    expect(RECENT_NOTES_TEXT_CAP_CHARS).toBe(60_000);
  });

  test("helper types", () => {
    expectTypeOf<ToolInput<"get_recent_notes">>().toEqualTypeOf<{ course: string; days?: number | undefined }>();
    expectTypeOf<ToolArgs<"get_recent_notes">>().toEqualTypeOf<{ course: string; days: number }>();
    expectTypeOf<ToolOutput<"list_courses">["courses"][number]["term"]>().toEqualTypeOf<string | null>();
  });
});

describe("ENDPOINTS", () => {
  test("has exactly the 10 paths from the plan", () => {
    expect(ENDPOINT_NAMES.map((n) => ENDPOINTS[n].path).sort()).toEqual(
      [
        "/api/agent/reply",
        "/api/alerts/deadline-change",
        "/api/alerts/demo",
        "/api/chat",
        "/api/grades",
        "/api/ingest",
        "/api/magic-link",
        "/api/sms/inbound",
        "/cal/:token.ics",
        "/open/:token",
      ],
    );
  });

  test.each(ENDPOINT_NAMES)("%s: request accepts a valid example and rejects bad ones", (name) => {
    check(ENDPOINTS[name].request, endpointCases[name].request);
  });

  test.each(ENDPOINT_NAMES)("%s: response accepts a valid example and rejects bad ones", (name) => {
    const schema = ENDPOINTS[name].response;
    const c = endpointCases[name].response;
    if (schema === null) {
      expect(c).toBeNull();
      expect(ENDPOINTS[name].responseType).not.toBe("json");
      return;
    }
    expect(c).not.toBeNull();
    check(schema, c!);
  });

  test("non-JSON routes are described by constants", () => {
    expect(ENDPOINTS.open.responseType).toBe("redirect");
    expect(OPEN_RESPONSE.status).toBe(302);
    expect(ENDPOINTS.calFeed.responseType).toBe("text/calendar");
    expect(CAL_FEED_RESPONSE.contentType).toMatch(/^text\/calendar/);
    expect(ENDPOINTS.chat.responseType).toBe("ndjson-stream");
    expect(CHAT_STREAM_CONTENT_TYPE).toBe("application/x-ndjson");
  });

  test("chat stream events: every variant parses", () => {
    const events = [
      { type: "text", delta: "The Marshall Plan " },
      { type: "citation", fileId: FILE, page: 4, deepLink: noteUrl(APP, FILE, 4) },
      { type: "done", sessionId: SESSION },
      { type: "error", message: "Something went wrong." },
    ];
    for (const e of events) expect(ChatStreamEvent.safeParse(e).success).toBe(true);
  });

  test("sms inbound keeps unknown provider keys", () => {
    const parsed = ENDPOINTS.smsInbound.request.parse({ from_number: "+14135550123", content: "hi", status: "RECEIVED" });
    expect(parsed.status).toBe("RECEIVED");
  });

  test("grades endpoint returns the get_grades shape", () => {
    expect(ENDPOINTS.grades.response).toBe(TOOLS.get_grades.output);
  });

  test("server-to-server routes use the internal secret header", () => {
    expect(INTERNAL_SECRET_HEADER).toBe("x-internal-secret");
    const internal = ENDPOINT_NAMES.filter((n) => ENDPOINTS[n].auth === "internal").sort();
    expect(internal).toEqual(["agentReply", "alertsDeadlineChange", "ingest", "magicLink"]);
  });

  test("helper types", () => {
    expectTypeOf<EndpointRequest<"magicLink">>().toEqualTypeOf<{ studentId: string; fileId: string; page: number }>();
    expectTypeOf<EndpointResponse<"agentReply">>().toEqualTypeOf<{ text: string; deepLink?: string | undefined }>();
    expectTypeOf<EndpointResponse<"open">>().toEqualTypeOf<never>();
  });
});

describe("shared enums", () => {
  test("values", () => {
    expect(Channel.options).toEqual(["web", "sms"]);
    expect(IngestStatus.options).toEqual(["pending", "processing", "ready", "failed"]);
    expect(FileSource.options).toEqual(["canvas", "manual"]);
    expect(AlertKind.options).toEqual(["crunch_week", "date_change"]);
    expect(SmsDirection.options).toEqual(["inbound", "outbound"]);
    expect(DeadlineStatus.options).toEqual(["upcoming", "submitted", "graded", "overdue"]);
    expect(LlmMode.options).toEqual(["mock", "gemini"]);
  });

  test("reject unknown values", () => {
    expect(Channel.safeParse("email").success).toBe(false);
    expect(FileSource.safeParse("upload").success).toBe(false);
    expect(AlertKind.safeParse("crunch").success).toBe(false);
    expect(SmsDirection.safeParse("in").success).toBe(false);
  });
});
