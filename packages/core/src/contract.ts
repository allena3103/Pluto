/**
 * Pluto code contract: zod schemas and inferred types for the 7 MCP tools and the
 * 10 internal endpoints in `docs/plan.md`. The plan is the human-readable source;
 * this file must agree with it. A name or field changes in the plan first, then here.
 *
 * Conventions
 * - camelCase fields (the Sendblue webhook payload is the one snake_case exception).
 * - Ids are uuid strings. Timestamps are ISO 8601 with an offset (`2026-11-13T09:00:00Z`
 *   or `...-05:00`). Dates without a time are `YYYY-MM-DD`.
 * - Page numbers are 1-based integers everywhere.
 * - Tool outputs are objects, never bare arrays, so fields can be added later.
 * - Every note result carries `deepLink`: an absolute URL to `/notes/<fileId>?page=<n>`
 *   (build it with `noteUrl` from `./deep-links`).
 * - Every tool is scoped to the signed-in student. The 7 tools in `TOOLS` are read-only;
 *   the one write tool, `save_study_guide`, lives in `WRITE_TOOLS` so the web/SMS agent
 *   (which iterates `TOOLS`) never sees it.
 */
import { z } from "zod";
import { parseNotePath } from "./deep-links";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Uuid string. Uses the lenient 8-4-4-4-12 hex check so fixed seed ids are accepted. */
export const Id = z.guid();

/** ISO 8601 timestamp with an offset (`Z` or `+hh:mm`). */
export const Timestamp = z.iso.datetime({ offset: true });

/** Calendar date `YYYY-MM-DD`. */
export const DateOnly = z.iso.date();

export const MAX_PAGE = 10_000;

/** 1-based page number. */
export const PageNumber = z.number().int().min(1).max(MAX_PAGE);

/**
 * Absolute http(s) URL to `/notes/<fileId>?page=<n>` in the web app (1-based page).
 * Build it with `noteUrl` from `./deep-links`.
 */
export const DeepLink = z
  .url({ protocol: /^https?$/ })
  .refine((value) => parseNotePath(value) !== null, {
    message: "deepLink must be an absolute URL to /notes/<fileId>?page=<n>",
  });

const Count = z.number().int().min(0);
const Percent = z.number().min(0);

/** A course reference typed by a person or a model: a course id or a case-insensitive course name. */
const CourseRef = z.string().trim().min(1).max(200);

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

export const Channel = z.enum(["web", "sms"]);
export type Channel = z.infer<typeof Channel>;

export const IngestStatus = z.enum(["pending", "processing", "ready", "failed"]);
export type IngestStatus = z.infer<typeof IngestStatus>;

export const FileSource = z.enum(["canvas", "manual"]);
export type FileSource = z.infer<typeof FileSource>;

export const AlertKind = z.enum(["crunch_week", "date_change"]);
export type AlertKind = z.infer<typeof AlertKind>;

export const SmsDirection = z.enum(["inbound", "outbound"]);
export type SmsDirection = z.infer<typeof SmsDirection>;

export const DeadlineStatus = z.enum(["upcoming", "submitted", "graded", "overdue"]);
export type DeadlineStatus = z.infer<typeof DeadlineStatus>;

/** `PLUTO_LLM`: `mock` runs deterministic scripted tool calls, `gemini` calls the Gemini API. */
export const LlmMode = z.enum(["mock", "gemini"]);
export type LlmMode = z.infer<typeof LlmMode>;

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export const Course = z.object({
  courseId: Id,
  name: z.string(),
  /** e.g. "Fall 2026"; null when Canvas gives none. */
  term: z.string().nullable(),
});
export type Course = z.infer<typeof Course>;

export const NotePage = z.object({
  page: PageNumber,
  text: z.string(),
  deepLink: DeepLink,
});
export type NotePage = z.infer<typeof NotePage>;

// ---------------------------------------------------------------------------
// Tool: list_courses
// ---------------------------------------------------------------------------

export const ListCoursesInput = z.object({});
export const ListCoursesOutput = z.object({
  courses: z.array(Course),
});

// ---------------------------------------------------------------------------
// Tool: get_recent_notes
// ---------------------------------------------------------------------------

/**
 * Cap on the total characters of page text returned by one `get_recent_notes` call.
 * When the cap is reached the output sets `truncated: true`; the caller fetches the
 * remaining pages with `get_note_pages`.
 */
export const RECENT_NOTES_TEXT_CAP_CHARS = 60_000;

export const GetRecentNotesInput = z.object({
  /** Course id or case-insensitive course name. */
  course: CourseRef,
  /** Window size: files added in the last `days` days. */
  days: z.number().int().min(1).max(365).default(14),
});

export const RecentNotesFile = z.object({
  fileId: Id,
  title: z.string(),
  /** e.g. "Week 9"; null when unknown. */
  weekLabel: z.string().nullable(),
  addedAt: Timestamp,
  /** Total pages in the file. */
  pageCount: Count,
  /**
   * How many pages are in `pages`. Pages are always a prefix: 1..pagesIncluded.
   * When `pagesIncluded < pageCount`, resume with
   * `get_note_pages({ fileId, firstPage: pagesIncluded + 1 })`.
   */
  pagesIncluded: Count,
  /** Link to page 1 of the file. */
  deepLink: DeepLink,
  pages: z.array(NotePage),
});
export type RecentNotesFile = z.infer<typeof RecentNotesFile>;

/**
 * Files are ordered oldest first by `addedAt`; pages ascending. Every file in the
 * window is listed even after the text cap is hit (then with `pagesIncluded: 0` and
 * `pages: []`), so the caller knows what is left to fetch.
 */
export const GetRecentNotesOutput = z.object({
  course: Course,
  files: z.array(RecentNotesFile),
  /** True when any file has `pagesIncluded < pageCount`. */
  truncated: z.boolean(),
});

// ---------------------------------------------------------------------------
// Tool: get_note_pages
// ---------------------------------------------------------------------------

export const GetNotePagesInput = z
  .object({
    fileId: Id,
    /** Defaults to 1 when omitted. */
    firstPage: PageNumber.optional(),
    /** Defaults to the last page of the file when omitted. */
    lastPage: PageNumber.optional(),
  })
  .refine((v) => v.firstPage === undefined || v.lastPage === undefined || v.firstPage <= v.lastPage, {
    message: "firstPage must be <= lastPage",
    path: ["lastPage"],
  });

/**
 * Uses the same text cap as `get_recent_notes`. When `truncated` is true, call again
 * with `firstPage` set to the last returned page + 1.
 */
export const GetNotePagesOutput = z.object({
  fileId: Id,
  title: z.string(),
  courseId: Id,
  courseName: z.string(),
  pageCount: Count,
  /** Link to the first returned page (page 1 when no pages are returned). */
  deepLink: DeepLink,
  pages: z.array(NotePage),
  truncated: z.boolean(),
});

// ---------------------------------------------------------------------------
// Tool: search_notes
// ---------------------------------------------------------------------------

export const SEARCH_NOTES_MAX_LIMIT = 50;

export const SearchNotesInput = z.object({
  query: z.string().trim().min(1).max(500),
  /** Optional course id or case-insensitive course name; all courses when omitted. */
  course: CourseRef.optional(),
  limit: z.number().int().min(1).max(SEARCH_NOTES_MAX_LIMIT).default(10),
});

export const SearchNotesResult = z.object({
  fileId: Id,
  title: z.string(),
  courseId: Id,
  courseName: z.string(),
  weekLabel: z.string().nullable(),
  page: PageNumber,
  /** Short excerpt of the page around the match. */
  snippet: z.string(),
  deepLink: DeepLink,
});
export type SearchNotesResult = z.infer<typeof SearchNotesResult>;

/** Best match first. */
export const SearchNotesOutput = z.object({
  results: z.array(SearchNotesResult),
});

// ---------------------------------------------------------------------------
// Tool: get_deadlines
// ---------------------------------------------------------------------------

export const GetDeadlinesInput = z.object({
  /** Optional course id or case-insensitive course name; all courses when omitted. */
  course: CourseRef.optional(),
  daysAhead: z.number().int().min(1).max(365).default(30),
});

export const Deadline = z.object({
  assignmentId: Id,
  courseId: Id,
  courseName: z.string(),
  title: z.string(),
  dueAt: Timestamp,
  /** The due date before it moved; null when it never moved. */
  previousDueAt: Timestamp.nullable(),
  /** Points possible; null when the assignment has none. */
  points: z.number().min(0).nullable(),
  /** Grade group name (e.g. "Exams"); null when the assignment is in no group. */
  weightGroup: z.string().nullable(),
  status: DeadlineStatus,
  /** Files linked from the assignment's instructions in Canvas; read them with get_assignment. */
  attachmentCount: Count,
});
export type Deadline = z.infer<typeof Deadline>;

/** Soonest due first. */
export const GetDeadlinesOutput = z.object({
  deadlines: z.array(Deadline),
});

// ---------------------------------------------------------------------------
// Tool: get_assignment
// ---------------------------------------------------------------------------

/** Shared by the instructions and every attachment's pages. */
export const ASSIGNMENT_TEXT_CAP_CHARS = 60_000;

export const GetAssignmentInput = z.object({
  /** From get_deadlines. */
  assignmentId: Id,
});

export const AssignmentFilePage = z.object({
  page: PageNumber,
  text: z.string(),
});

export const AssignmentAttachment = z.object({
  attachmentId: Id,
  /** File name as in Canvas, e.g. "BIA_Project_Description.docx". */
  title: z.string(),
  /** pdf and docx are read; other files (spreadsheets, databases) are listed by name only. */
  fileType: z.enum(["pdf", "docx", "other"]),
  /** ready: `pages` holds the text; pending: not downloaded yet; failed/skipped: no text. */
  status: z.enum(["pending", "ready", "failed", "skipped"]),
  pageCount: Count.nullable(),
  /** Absolute URL to the file in the web app: `/assignments/<assignmentId>/files/<attachmentId>`. */
  url: z.url({ protocol: /^https?$/ }),
  pages: z.array(AssignmentFilePage),
});
export type AssignmentAttachment = z.infer<typeof AssignmentAttachment>;

/**
 * The instructions and attachment text share `ASSIGNMENT_TEXT_CAP_CHARS`. When `truncated`
 * is true, some attachment pages were left out; the student can open `url`.
 */
export const GetAssignmentOutput = z.object({
  assignmentId: Id,
  courseId: Id,
  courseName: z.string(),
  title: z.string(),
  dueAt: Timestamp.nullable(),
  points: z.number().min(0).nullable(),
  status: DeadlineStatus,
  /** The assignment description from Canvas as plain text; null when it has none. */
  instructions: z.string().nullable(),
  /** Absolute URL to the assignment in the web app: `/assignments/<assignmentId>`. */
  url: z.url({ protocol: /^https?$/ }),
  attachments: z.array(AssignmentAttachment),
  truncated: z.boolean(),
});

// ---------------------------------------------------------------------------
// Tool: get_grades (also the response of GET /api/grades)
// ---------------------------------------------------------------------------

export const GetGradesInput = z.object({
  /** Optional course id or case-insensitive course name; all courses when omitted. */
  course: CourseRef.optional(),
});

export const GradeGroup = z.object({
  name: z.string(),
  /** The group's weight in the course grade, 0-100. */
  weightPercent: Percent.max(100),
  /** Points earned / points possible over the group's graded items, as a percent; null when nothing is graded. */
  scorePercent: Percent.nullable(),
  gradedCount: Count,
  ungradedCount: Count,
});
export type GradeGroup = z.infer<typeof GradeGroup>;

/**
 * Running weighted grade formula:
 *   weightedGradePercent =
 *     sum(scorePercent * weightPercent  for groups with gradedCount > 0)
 *     / sum(weightPercent               for groups with gradedCount > 0)
 * i.e. a weighted average over the groups that have graded items, renormalised by
 * the sum of those groups' weights. Null when no group has a graded item (or the
 * weights of the graded groups sum to 0). `ungradedCount` is the sum over groups.
 */
export const CourseGrades = z.object({
  courseId: Id,
  courseName: z.string(),
  groups: z.array(GradeGroup),
  weightedGradePercent: Percent.nullable(),
  ungradedCount: Count,
});
export type CourseGrades = z.infer<typeof CourseGrades>;

export const GetGradesOutput = z.object({
  courses: z.array(CourseGrades),
});

// ---------------------------------------------------------------------------
// Tool: get_crunch_weeks
// ---------------------------------------------------------------------------

export const GetCrunchWeeksInput = z.object({
  weeksAhead: z.number().int().min(1).max(26).default(8),
});

export const CrunchWeek = z.object({
  /** Monday of the week, `YYYY-MM-DD`. */
  weekStart: DateOnly,
  /** Sunday of the week, `YYYY-MM-DD`. */
  weekEnd: DateOnly,
  /** Number of deliverables due in the week. */
  deliverableCount: Count,
  /** Sum of the course-grade weight (percent) carried by the week's deliverables. */
  totalWeightPercent: Percent,
  /** Ranking score; higher is heavier. Only meaningful relative to other weeks in the same response. */
  score: z.number().min(0),
  /** 1 = heaviest week. */
  rank: z.number().int().min(1),
  assignments: z.array(Deadline),
});
export type CrunchWeek = z.infer<typeof CrunchWeek>;

/** Ordered by `rank` (heaviest first). Weeks with no deliverables are left out. */
export const GetCrunchWeeksOutput = z.object({
  weeks: z.array(CrunchWeek),
});

// ---------------------------------------------------------------------------
// TOOLS map
// ---------------------------------------------------------------------------

export const TOOLS = {
  list_courses: {
    name: "list_courses",
    description:
      "Read-only. Lists the signed-in student's courses with id, name and term. Use it first to find a course id or the exact course name for the other tools.",
    input: ListCoursesInput,
    output: ListCoursesOutput,
  },
  get_recent_notes: {
    name: "get_recent_notes",
    description:
      "Read-only. Returns the full page-by-page text of every lecture file added to one course in the last `days` days (default 14), each page with a deep link for citations. Use it to build study guides or summaries; if `truncated` is true, fetch the remaining pages with get_note_pages.",
    input: GetRecentNotesInput,
    output: GetRecentNotesOutput,
  },
  get_note_pages: {
    name: "get_note_pages",
    description:
      "Read-only. Returns the text of one file's pages, optionally limited to firstPage..lastPage (1-based, inclusive), each with a deep link. Use it to read a specific file or to fetch pages that get_recent_notes left out.",
    input: GetNotePagesInput,
    output: GetNotePagesOutput,
  },
  search_notes: {
    name: "search_notes",
    description:
      "Read-only. Full-text search over the student's lecture notes, optionally within one course. Returns matching pages with file, page number, a short snippet and a deep link; use it to find where a topic is covered.",
    input: SearchNotesInput,
    output: SearchNotesOutput,
  },
  get_deadlines: {
    name: "get_deadlines",
    description:
      "Read-only. Lists assignments due in the next `daysAhead` days (default 30), optionally for one course, with due date, previous due date if it moved, points, weight group and status. Use it for questions about what is due and when.",
    input: GetDeadlinesInput,
    output: GetDeadlinesOutput,
  },
  get_assignment: {
    name: "get_assignment",
    description:
      "Read-only. Returns one assignment's instructions from Canvas and the text of its attached files (PDF and Word), with links to open them in Pluto. Get `assignmentId` from get_deadlines. Use it when the student asks what an assignment requires or to see its handout or attachment.",
    input: GetAssignmentInput,
    output: GetAssignmentOutput,
  },
  get_grades: {
    name: "get_grades",
    description:
      "Read-only. Returns score and weight per grade group, the running weighted grade and the count of ungraded items, for one course or all courses. Use it for questions about current grades.",
    input: GetGradesInput,
    output: GetGradesOutput,
  },
  get_crunch_weeks: {
    name: "get_crunch_weeks",
    description:
      "Read-only. Ranks the next `weeksAhead` weeks (default 8) by the number and grade weight of deliverables due, heaviest first. Use it to find the student's busiest weeks and plan ahead.",
    input: GetCrunchWeeksInput,
    output: GetCrunchWeeksOutput,
  },
} as const;

export type ToolName = keyof typeof TOOLS;

export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];

/** What a caller may pass (fields with defaults are optional). */
export type ToolInput<N extends ToolName> = z.input<(typeof TOOLS)[N]["input"]>;

/** The input after `TOOLS[name].input.parse(...)` (defaults applied). Tool functions receive this. */
export type ToolArgs<N extends ToolName> = z.output<(typeof TOOLS)[N]["input"]>;

export type ToolOutput<N extends ToolName> = z.output<(typeof TOOLS)[N]["output"]>;

// ---------------------------------------------------------------------------
// Write tool: save_study_guide (MCP only; see docs/plan.md "Write tool rules")
// ---------------------------------------------------------------------------

/** Most cited pages kept on one saved guide. */
export const SAVE_STUDY_GUIDE_MAX_SOURCES = 100;

/** MCP saves allowed per student per rolling hour; the next one is `rate_limited`. */
export const SAVE_STUDY_GUIDE_HOURLY_LIMIT = 10;

export const SaveStudyGuideInput = z.object({
  /** Short title shown on the Notes page, e.g. "History 105 study guide". */
  title: z.string().trim().min(1).max(200),
  /** The full guide in markdown, with page deep links (`/notes/<fileId>?page=<n>`) kept. */
  markdown: z.string().min(1).max(60_000),
  /** Course id or case-insensitive course name. Omit to use the class every cited file shares. */
  course: CourseRef.optional(),
});

export const TextStatus = z.enum(["sent", "no_phone", "failed"]);
export type TextStatus = z.infer<typeof TextStatus>;

export const SaveStudyGuideOutput = z.object({
  noteId: Id,
  title: z.string(),
  /** Class the note is filed under; null when none. */
  courseName: z.string().nullable(),
  /** Absolute web link to `/notes/saved/<noteId>` (sign-in required). */
  url: z.url({ protocol: /^https?$/ }),
  /** Cited pages kept in `sources` (own files, existing pages, deduped, at most 100). */
  citedPages: Count,
  /** `sent`: a magic link was texted; `no_phone`: no linked phone; `failed`: the text failed (the note is still saved). */
  textStatus: TextStatus,
});

export const WRITE_TOOLS = {
  save_study_guide: {
    name: "save_study_guide",
    description:
      "Saves a finished study guide to the student's Pluto Notes page and texts the student's linked phone a one-time link to open it. Adds one note; never edits or deletes anything.",
    input: SaveStudyGuideInput,
    output: SaveStudyGuideOutput,
  },
} as const;

export type WriteToolName = keyof typeof WRITE_TOOLS;

export const WRITE_TOOL_NAMES = Object.keys(WRITE_TOOLS) as WriteToolName[];

export type WriteToolInput<N extends WriteToolName> = z.input<(typeof WRITE_TOOLS)[N]["input"]>;
export type WriteToolArgs<N extends WriteToolName> = z.output<(typeof WRITE_TOOLS)[N]["input"]>;
export type WriteToolOutput<N extends WriteToolName> = z.output<(typeof WRITE_TOOLS)[N]["output"]>;

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/**
 * Server-to-server routes require this header to equal `INTERNAL_API_SECRET`.
 * Verify it before touching the service-role client.
 */
export const INTERNAL_SECRET_HEADER = "x-internal-secret";

/** One-time or feed token in a URL path. */
const UrlToken = z.string().min(1).max(512);

const MessageText = z.string().trim().min(1).max(4000);

// --- POST /api/ingest ------------------------------------------------------

export const IngestRequest = z.object({ fileId: Id });
export const IngestResponse = z.object({
  fileId: Id,
  status: IngestStatus,
  /** Set when `status` is `ready`. */
  pageCount: Count.optional(),
  /** Set when `status` is `failed`. */
  error: z.string().optional(),
});

// --- POST /api/chat --------------------------------------------------------

export const ChatRequest = z.object({
  /** Omit to start a new session; the `done` event returns the session id. */
  sessionId: Id.optional(),
  message: MessageText,
});

/** Limits for questions the agent asks when a request is missing a class, time range or other detail. */
export const CLARIFY_MAX_QUESTIONS = 3;
export const CLARIFY_MAX_OPTIONS = 8;

/**
 * One question the agent asks before it answers. `options` are tappable choices
 * (`multiple` lets the student pick more than one). `allowText` adds a typed answer;
 * a question with no options always takes a typed answer.
 */
export const ClarifyingQuestion = z.object({
  id: z.string().trim().min(1).max(40),
  prompt: z.string().trim().min(1).max(300),
  options: z.array(z.string().trim().min(1).max(120)).max(CLARIFY_MAX_OPTIONS),
  multiple: z.boolean(),
  allowText: z.boolean(),
});
export type ClarifyingQuestion = z.infer<typeof ClarifyingQuestion>;

/**
 * `/api/chat` does not return one JSON body. It streams newline-delimited JSON
 * (`CHAT_STREAM_CONTENT_TYPE`): one `ChatStreamEvent` per line. The stream ends
 * with exactly one `done` or `error` event.
 */
export const CHAT_STREAM_CONTENT_TYPE = "application/x-ndjson";

export const ChatStreamEvent = z.discriminatedUnion("type", [
  /** A piece of the reply text; concatenate deltas in order. */
  z.object({ type: z.literal("text"), delta: z.string() }),
  /** A notes page the reply cites. `title` is the file's title, for the source chip ("<title> p.<page>"). */
  z.object({
    type: z.literal("citation"),
    fileId: Id,
    page: PageNumber,
    deepLink: DeepLink,
    title: z.string().min(1).max(300).optional(),
  }),
  /** The agent needs more detail before it answers; the student replies with a new message. */
  z.object({
    type: z.literal("questions"),
    questions: z.array(ClarifyingQuestion).min(1).max(CLARIFY_MAX_QUESTIONS),
  }),
  /** A notes-based reply was saved to the Notes page under `courseName` (null: more than one class). */
  z.object({
    type: z.literal("saved_note"),
    noteId: Id,
    courseId: Id.nullable(),
    courseName: z.string().nullable(),
  }),
  /** The reply is complete. */
  z.object({ type: z.literal("done"), sessionId: Id }),
  /** The reply failed; `message` is safe to show to the student. */
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEvent>;

// --- POST /api/agent/reply -------------------------------------------------

export const AgentReplyRequest = z.object({
  studentId: Id,
  text: MessageText,
  channel: Channel,
});
export const AgentReplyResponse = z.object({
  text: z.string(),
  /** For `sms` this is a one-time magic-link URL; for `web` a plain notes deep link. */
  deepLink: z.url().optional(),
});

// --- GET /api/grades -------------------------------------------------------

/** Query string: `?course=<id or name>`. */
export const GradesRequest = GetGradesInput;
export const GradesResponse = GetGradesOutput;

// --- POST /api/magic-link --------------------------------------------------

export const MagicLinkRequest = z.object({
  studentId: Id,
  fileId: Id,
  page: PageNumber,
});
export const MagicLinkResponse = z.object({
  /** Absolute one-time URL to `/open/<token>`. */
  url: z.url(),
  /** 15 minutes after creation. */
  expiresAt: Timestamp,
});

// --- GET /open/:token ------------------------------------------------------

export const OpenParams = z.object({ token: UrlToken });

/**
 * `/open/:token` returns no JSON. On a valid, unused, unexpired token it signs the
 * student in and redirects to the notes page (`notePath(fileId, page)`), or to the
 * saved note (`/notes/saved/<id>`) for a saved-note link; otherwise it redirects to
 * `invalidLocation`.
 */
export const OPEN_RESPONSE = {
  kind: "redirect",
  status: 302,
  location: "/notes/<fileId>?page=<n>",
  savedNoteLocation: "/notes/saved/<id>",
  invalidLocation: "/login?error=link",
} as const;

// --- POST /api/sms/inbound -------------------------------------------------

/**
 * The Sendblue webhook payload. snake_case because the provider sends it; extra
 * keys are allowed and kept.
 */
export const SmsInboundRequest = z.looseObject({
  /** Sender's phone number, E.164 (e.g. "+14135550123"). */
  from_number: z.string().min(1).max(32),
  /** The message text. */
  content: z.string().max(10_000),
});
export const SmsInboundResponse = z.object({
  ok: z.boolean(),
});

// --- POST /api/alerts/demo and /api/alerts/deadline-change ------------------

export const AlertResponse = z.object({
  alertId: Id,
  /** False when the SMS could not be sent (the alert row is still saved). */
  sent: z.boolean(),
  /** Absolute URL of the student's ICS feed, `/cal/<token>.ics`. */
  calendarUrl: z.url(),
});
export type AlertResponse = z.infer<typeof AlertResponse>;

export const AlertDemoRequest = z.object({ studentId: Id });

export const AlertDeadlineChangeRequest = z.object({
  studentId: Id,
  assignmentId: Id,
  oldDueAt: Timestamp,
  newDueAt: Timestamp,
});

// --- GET /cal/:token.ics ---------------------------------------------------

/** `token` is the feed token without the `.ics` suffix. */
export const CalFeedParams = z.object({ token: UrlToken });

/** `/cal/:token.ics` returns an iCalendar document (study blocks), not JSON. 404 on an unknown token. */
export const CAL_FEED_RESPONSE = {
  kind: "text",
  contentType: "text/calendar; charset=utf-8",
} as const;

// --- ENDPOINTS map ---------------------------------------------------------

/**
 * `request` is the JSON body for POST routes, the query for `grades`, and the path
 * params for `open` and `calFeed`.
 * `response` is the JSON body schema; for `chat` it is the schema of one stream
 * event; it is null for the two routes that return no JSON (`responseType` and the
 * `OPEN_RESPONSE` / `CAL_FEED_RESPONSE` constants describe those).
 * `auth`: `internal` = `x-internal-secret` header; `session` = Supabase Auth
 * session of the student; `token` = the token in the path; `provider` = the SMS
 * provider's webhook secret/signature.
 */
export const ENDPOINTS = {
  ingest: {
    method: "POST",
    path: "/api/ingest",
    auth: "internal",
    requestIn: "body",
    request: IngestRequest,
    responseType: "json",
    response: IngestResponse,
  },
  chat: {
    method: "POST",
    path: "/api/chat",
    auth: "session",
    requestIn: "body",
    request: ChatRequest,
    responseType: "ndjson-stream",
    response: ChatStreamEvent,
  },
  agentReply: {
    method: "POST",
    path: "/api/agent/reply",
    auth: "internal",
    requestIn: "body",
    request: AgentReplyRequest,
    responseType: "json",
    response: AgentReplyResponse,
  },
  grades: {
    method: "GET",
    path: "/api/grades",
    auth: "session",
    requestIn: "query",
    request: GradesRequest,
    responseType: "json",
    response: GradesResponse,
  },
  magicLink: {
    method: "POST",
    path: "/api/magic-link",
    auth: "internal",
    requestIn: "body",
    request: MagicLinkRequest,
    responseType: "json",
    response: MagicLinkResponse,
  },
  open: {
    method: "GET",
    path: "/open/:token",
    auth: "token",
    requestIn: "params",
    request: OpenParams,
    responseType: "redirect",
    response: null,
  },
  smsInbound: {
    method: "POST",
    path: "/api/sms/inbound",
    auth: "provider",
    requestIn: "body",
    request: SmsInboundRequest,
    responseType: "json",
    response: SmsInboundResponse,
  },
  alertsDemo: {
    method: "POST",
    path: "/api/alerts/demo",
    // The demo button calls this from the browser: `studentId` must equal the
    // signed-in student. A valid `x-internal-secret` is accepted instead (timer).
    auth: "session",
    requestIn: "body",
    request: AlertDemoRequest,
    responseType: "json",
    response: AlertResponse,
  },
  calFeed: {
    method: "GET",
    path: "/cal/:token.ics",
    auth: "token",
    requestIn: "params",
    request: CalFeedParams,
    responseType: "text/calendar",
    response: null,
  },
  alertsDeadlineChange: {
    method: "POST",
    path: "/api/alerts/deadline-change",
    auth: "internal",
    requestIn: "body",
    request: AlertDeadlineChangeRequest,
    responseType: "json",
    response: AlertResponse,
  },
} as const;

export type EndpointName = keyof typeof ENDPOINTS;

export const ENDPOINT_NAMES = Object.keys(ENDPOINTS) as EndpointName[];

/** What a caller sends (fields with defaults are optional). */
export type EndpointRequest<N extends EndpointName> = z.input<(typeof ENDPOINTS)[N]["request"]>;

/** The JSON response body (one stream event for `chat`); `never` for routes that return no JSON. */
export type EndpointResponse<N extends EndpointName> = (typeof ENDPOINTS)[N]["response"] extends z.ZodType
  ? z.output<(typeof ENDPOINTS)[N]["response"]>
  : never;
