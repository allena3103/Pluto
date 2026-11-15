import { collectCitations } from "./citations";
import { parsePlanRequest, runMockPlan } from "./plan";
import { withDeadline } from "./timeout";
import {
  EMPTY_REPLY_TEXT,
  TOOL_FAILURE_TEXT,
  TOOL_TIMEOUT_MS,
  type AgentCitation,
  type AgentResult,
  type AgentToolRunner,
  type CreateMagicLink,
  type RunAgentInput,
} from "./types";

type MockCall = { name: string; args: Record<string, unknown> };

export function mockToolCall(message: string): MockCall {
  const text = message.toLowerCase();
  if (text.includes("grade")) return { name: "get_grades", args: {} };
  if (text.includes("due") || text.includes("deadline") || text.includes("assignment")) {
    return { name: "get_deadlines", args: {} };
  }
  if (text.includes("crunch") || text.includes("busiest") || text.includes("heaviest")) {
    return { name: "get_crunch_weeks", args: {} };
  }
  if (text.includes("course")) return { name: "list_courses", args: {} };

  const args: Record<string, unknown> = { query: mockSearchQuery(message), limit: 3 };
  if (text.includes("history 105")) args.course = "History 105";
  return { name: "search_notes", args };
}

// Words that describe the request, not the topic.
const FILLER: Record<string, true> = Object.fromEntries(
  [
    "about", "all", "and", "any", "are", "can", "check", "class", "classes", "course", "did", "does", "explain",
    "find", "for", "from", "get", "give", "has", "have", "history", "how", "lecture", "lectures", "let", "let's",
    "lets", "look", "mine", "need", "note", "notes", "open", "our", "over", "please", "pull", "read", "review",
    "say", "says", "see", "show", "slides", "some", "summarize", "take", "tell", "that", "the", "this", "want",
    "was", "were", "what", "what's", "whats", "when", "where", "which", "who", "why", "with", "you", "your", "105",
  ].map((word) => [word, true]),
);

function topicWords(message: string): string[] {
  return message
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((word) => word.length > 2 && FILLER[word] !== true);
}

/**
 * `search_notes` uses websearch_to_tsquery, which ANDs every word, so a whole question rarely matches.
 * Keep the topic words and OR them; fall back to the raw message when nothing is left.
 */
export function mockSearchQuery(message: string): string {
  const words = topicWords(message);
  return words.length > 0 ? words.join(" or ").slice(0, 500) : message.trim().slice(0, 500);
}

const NOTES_WORDS = /\b(notes?|lectures?|class(es)?|slides|readings?)\b/i;

/** "let's look at my class notes": about notes, but no topic to search for. */
export function isVagueNotesRequest(message: string): boolean {
  return NOTES_WORDS.test(message) && topicWords(message).length === 0 && mockToolCall(message).name === "search_notes";
}

type SearchHit = { title: string; page: number };

function firstSearchHit(result: unknown): SearchHit | undefined {
  const candidates: unknown[] = [];
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const record = result as Record<string, unknown>;
    if (Array.isArray(record.results)) candidates.push(...record.results);
    else candidates.push(result);
  }
  for (const item of candidates) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.title !== "string" || !record.title.trim()) continue;
    if (typeof record.page !== "number" || !Number.isInteger(record.page) || record.page < 1) continue;
    return { title: record.title.trim(), page: record.page };
  }
  return undefined;
}

function searchText(hit: SearchHit, channel: "web" | "sms"): string {
  const suffix = `", page ${hit.page}.`;
  const prefix = `Found it in "`;
  let title = hit.title.replace(/\s+/g, " ").trim();
  let sentence = `${prefix}${title}${suffix}`;
  if (channel === "sms" && sentence.length >= 300) {
    const room = 299 - prefix.length - suffix.length;
    title = room > 0 ? title.slice(0, room) : "";
    sentence = `${prefix}${title}${suffix}`.slice(0, 299);
  }
  return sentence;
}

function firstString(value: unknown, keys: string[]): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item, keys);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const field = record[key];
    if (typeof field === "string" && field.trim()) return field.trim();
  }
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") {
      const found = firstString(child, keys);
      if (found) return found;
    }
  }
  return undefined;
}

function summaryText(name: string, result: unknown): string {
  if (name === "get_grades") {
    const course = firstString(result, ["courseName", "name"]);
    return course ? `Your grade in ${course} is on file.` : "I couldn't find anything to report.";
  }
  if (name === "get_deadlines") {
    const title = firstString(result, ["title"]);
    return title ? `Your next deadline is "${title}".` : "I couldn't find anything to report.";
  }
  if (name === "get_crunch_weeks") {
    const weekStart = firstString(result, ["weekStart"]);
    return weekStart ? `Your busiest week starts ${weekStart}.` : "I couldn't find anything to report.";
  }
  const course = firstString(result, ["name", "courseName"]);
  return course ? `You're enrolled in ${course}.` : "I couldn't find anything to report.";
}

function replyText(name: string, result: unknown, channel: "web" | "sms"): string {
  if (name === "search_notes") {
    const hit = firstSearchHit(result);
    return hit ? searchText(hit, channel) : "I couldn't find that in your notes.";
  }
  const sentence = summaryText(name, result);
  return channel === "sms" && sentence.length >= 300 ? sentence.slice(0, 299) : sentence;
}

async function maybeMagicLink(
  channel: "web" | "sms",
  citations: AgentCitation[],
  createMagicLink: CreateMagicLink | undefined,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  const first = citations[0];
  if (channel !== "sms" || !createMagicLink || !first) return undefined;
  try {
    const created = await withDeadline(
      createMagicLink({ fileId: first.fileId, page: first.page }),
      TOOL_TIMEOUT_MS,
      signal,
    );
    return typeof created.url === "string" && created.url ? created.url : undefined;
  } catch {
    return undefined;
  }
}

type MockCourse = { name: string };

function courseNames(result: unknown): string[] {
  if (!result || typeof result !== "object" || !Array.isArray((result as { courses?: unknown }).courses)) return [];
  return ((result as { courses: unknown[] }).courses as MockCourse[])
    .map((course) => (course && typeof course.name === "string" ? course.name.trim() : ""))
    .filter(Boolean);
}

const WEEK_OPTIONS = ["This week", "Last 2 weeks", "Whole term"] as const;

function daysFor(message: string): number {
  const text = message.toLowerCase();
  if (text.includes("whole term")) return 120;
  if (text.includes("this week")) return 7;
  return 14;
}

type RecentPage = { page: number; text: string };
type RecentFile = { title: string; pages: RecentPage[] };

function notesText(heading: string, course: string, result: unknown): string {
  const files = (result && typeof result === "object" ? (result as { files?: unknown }).files : undefined) as
    | RecentFile[]
    | undefined;
  if (!Array.isArray(files) || files.length === 0) return `I couldn't find recent notes for ${course}.`;
  const sections = files.map((file) => {
    const bullets = (Array.isArray(file.pages) ? file.pages : []).slice(0, 4).map((page) => {
      const line = String(page.text ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
      return `- p.${page.page}: ${line || "(no text)"}`;
    });
    return [`## ${file.title}`, ...bullets].join("\n");
  });
  return [`# ${heading}`, ...sections].join("\n\n");
}

/**
 * Notes requests that need a class: study guides, and vague asks like "let's look at my class notes".
 * Asks for the class when there are several and none is named (web: question card; SMS: one short
 * question), otherwise reads that class's recent notes. Keeps the clarifying path testable without Gemini.
 * Answers arrive as the original request plus "Question? answer" lines, so the first line is the request.
 */
async function runMockClassNotes(input: RunAgentInput, runTool: AgentToolRunner): Promise<AgentResult> {
  const courses = courseNames(await withDeadline(runTool("list_courses", {}), TOOL_TIMEOUT_MS, input.signal));
  const text = input.message.toLowerCase();
  const studyGuide = /study guide/i.test(input.message);
  const named = courses.find((name) => text.includes(name.toLowerCase()));
  const course = named ?? (courses.length === 1 ? courses[0] : undefined);
  if (!course) {
    if (courses.length === 0) return { text: "I couldn't find any classes yet.", citations: [] };
    if (input.channel === "sms") {
      return { text: `Which class? ${courses.slice(0, 8).join(", ")}`.slice(0, 299), citations: [] };
    }
    return {
      text: studyGuide
        ? "Happy to make that study guide. A couple of quick questions first:"
        : "Sure! Which notes do you want to look at?",
      citations: [],
      questions: [
        { id: "class", prompt: "Which class?", options: courses.slice(0, 8), multiple: false, allowText: false },
        { id: "weeks", prompt: "Which notes should I use?", options: [...WEEK_OPTIONS], multiple: false, allowText: true },
      ],
    };
  }
  const result = await withDeadline(
    runTool("get_recent_notes", { course, days: daysFor(input.message) }),
    TOOL_TIMEOUT_MS,
    input.signal,
  );
  const heading = studyGuide ? `${course} study guide` : `${course} notes`;
  const reply = notesText(heading, course, result);
  return {
    text: input.channel === "sms" ? `Your recent ${course} notes are ready.` : reply,
    citations: collectCitations(result),
  };
}

export async function runMock(input: RunAgentInput, runTool: AgentToolRunner): Promise<AgentResult> {
  if (input.signal?.aborted) return { text: EMPTY_REPLY_TEXT, citations: [] };

  const plan = parsePlanRequest(input.message);
  if (plan) return runMockPlan(input, runTool, plan);

  const request = input.message.split("\n", 1)[0] ?? "";
  const studyGuide = input.channel === "web" && /study guide/i.test(request);
  if (studyGuide || isVagueNotesRequest(request)) {
    try {
      return await runMockClassNotes(input, runTool);
    } catch {
      return { text: TOOL_FAILURE_TEXT, citations: [] };
    }
  }

  const call = mockToolCall(input.message);
  let result: unknown;
  try {
    result = await withDeadline(runTool(call.name, call.args), TOOL_TIMEOUT_MS, input.signal);
  } catch {
    return { text: TOOL_FAILURE_TEXT, citations: [] };
  }

  const citations = collectCitations(result);
  const text = replyText(call.name, result, input.channel);
  const magicLinkUrl = await maybeMagicLink(input.channel, citations, input.createMagicLink, input.signal);
  return magicLinkUrl ? { text, citations, magicLinkUrl } : { text, citations };
}
