import { collectCitations } from "./citations";
import { withDeadline } from "./timeout";
import {
  EMPTY_REPLY_TEXT,
  TOOL_FAILURE_TEXT,
  TOOL_TIMEOUT_MS,
  type AgentResult,
  type AgentToolRunner,
  type RunAgentInput,
} from "./types";

/** Matches the request the host builds for a crunch-week "YES" (apps/web/lib/crunch-plan.ts). */
const PLAN_REQUEST =
  /day-by-day study plan for the week (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})\b.*?daysAhead (\d{1,3})\b/s;

const ZONE = "America/New_York";
const PLAN_MAX_CHARS = 600;

export type PlanRequest = { weekStart: string; weekEnd: string; daysAhead: number };

export function parsePlanRequest(message: string): PlanRequest | null {
  const match = PLAN_REQUEST.exec(message);
  if (!match) return null;
  const daysAhead = Number(match[3]);
  if (!Number.isInteger(daysAhead) || daysAhead < 1 || daysAhead > 365) return null;
  return { weekStart: match[1]!, weekEnd: match[2]!, daysAhead };
}

type PlanItem = { title: string; courseName: string; dueAt: string; day: string };

function easternDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );
}

function items(result: unknown, request: PlanRequest): PlanItem[] {
  const list = (result as { deadlines?: unknown } | null)?.deadlines;
  if (!Array.isArray(list)) return [];
  const out: PlanItem[] = [];
  for (const raw of list) {
    const d = raw as Record<string, unknown> | null;
    if (!d || typeof d.title !== "string" || typeof d.courseName !== "string" || typeof d.dueAt !== "string") continue;
    if (Number.isNaN(new Date(d.dueAt).getTime())) continue;
    const day = easternDay(d.dueAt);
    if (day < request.weekStart || day > request.weekEnd) continue;
    out.push({ title: d.title.trim(), courseName: d.courseName.trim(), dueAt: d.dueAt, day });
  }
  return out.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
}

function dayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** One line per day that has something due, items in due order. Under `PLAN_MAX_CHARS`. */
export function planText(list: PlanItem[]): string {
  if (list.length === 0) return "Nothing is due that week, so there is nothing to plan.";
  const days = new Map<string, PlanItem[]>();
  for (const item of list) days.set(item.day, [...(days.get(item.day) ?? []), item]);
  const lines = [...days.entries()].map(
    ([day, due]) =>
      `${dayLabel(day)}: ` + due.map((i) => `${i.title} (${i.courseName}) due ${timeLabel(i.dueAt)}`).join("; "),
  );
  let text = `Your plan:\n${lines.join("\n")}`;
  while (text.length > PLAN_MAX_CHARS && lines.length > 1) {
    lines.pop();
    text = `Your plan:\n${lines.join("\n")}`;
  }
  return text.length > PLAN_MAX_CHARS ? `${text.slice(0, PLAN_MAX_CHARS - 1)}…` : text;
}

export async function runMockPlan(
  input: RunAgentInput,
  runTool: AgentToolRunner,
  request: PlanRequest,
): Promise<AgentResult> {
  let list: PlanItem[];
  try {
    const result = await withDeadline(runTool("get_deadlines", { daysAhead: request.daysAhead }), TOOL_TIMEOUT_MS, input.signal);
    list = items(result, request);
  } catch {
    return { text: TOOL_FAILURE_TEXT, citations: [] };
  }
  if (list.length === 0) return { text: planText(list) || EMPTY_REPLY_TEXT, citations: [] };

  // Notes for the first item, so the reply carries a citation (the host adds the link).
  // `search_notes` ANDs words, so OR the title's topic words, then fall back to the course's notes.
  const first = list[0]!;
  const topic = first.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3).join(" or ");
  let citations: AgentResult["citations"] = [];
  for (const query of [topic, "lecture or week or notes"]) {
    if (!query) continue;
    try {
      const found = await withDeadline(
        runTool("search_notes", { query, course: first.courseName, limit: 3 }),
        TOOL_TIMEOUT_MS,
        input.signal,
      );
      citations = collectCitations(found);
    } catch {
      // The plan still stands without a note link.
    }
    if (citations.length > 0) break;
  }
  return { text: planText(list), citations };
}
