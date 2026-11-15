import type { PlutoDb } from "@pluto/core/context";

/** A reply only counts as "yes" this long after the crunch-week text was sent. */
export const CRUNCH_PLAN_WINDOW_MS = 24 * 60 * 60 * 1000;

const YES_PATTERN =
  /^(?:y|yes|yeah|yep|yup|sure|ok|okay|please|plan|yes please|sure thing)[.!]?$/i;

/** True when the whole trimmed text is a short yes (optional trailing `.` or `!`). */
export function isYesReply(text: string): boolean {
  return YES_PATTERN.test(text.trim());
}

export type CrunchAlert = { weekStart: string; sentAt: string };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(value: string): Date | null {
  if (!DATE_ONLY.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

/** `YYYY-MM-DD` six days after `weekStart`, or null when `weekStart` is not a date. */
export function weekEndOf(weekStart: string): string | null {
  const start = parseDateOnly(weekStart);
  if (!start) return null;
  return new Date(start.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The plan request the agent receives. It is built from the alert row only, never
 * from the student's text. `daysAhead` reaches the end of the week so
 * `get_deadlines` (which counts from today) covers it.
 */
export function buildPlanRequest(weekStart: string, now: Date = new Date()): string | null {
  const weekEnd = weekEndOf(weekStart);
  if (!weekEnd) return null;
  const end = new Date(`${weekEnd}T00:00:00Z`).getTime() + 86_400_000;
  const daysAhead = Math.min(365, Math.max(1, Math.ceil((end - now.getTime()) / 86_400_000) + 1));
  return (
    `Make a short day-by-day study plan for the week ${weekStart} to ${weekEnd}. ` +
    `Call get_deadlines with daysAhead ${daysAhead} and keep only what is due from ${weekStart} to ${weekEnd}. ` +
    `Call search_notes for the notes on the first item. ` +
    `One short line per day, items in due-date order with the course and due time. ` +
    `Keep it short enough for a text.`
  );
}

/**
 * The student's newest sent `crunch_week` alert, when it was sent within the window
 * and has a week. Always filtered by `student_id`. Any failure means "no alert":
 * the message then goes to the agent unchanged.
 */
export async function findRecentCrunchAlert(
  admin: PlutoDb,
  studentId: string,
  now: Date = new Date(),
): Promise<CrunchAlert | null> {
  const { data, error } = await admin
    .from("alerts")
    .select("week_start, sent_at")
    .eq("student_id", studentId)
    .eq("kind", "crunch_week")
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("crunch alert lookup failed:", error.code ?? "error");
    return null;
  }
  if (!data?.sent_at || !data.week_start) return null;
  const sent = new Date(data.sent_at).getTime();
  const age = now.getTime() - sent;
  if (Number.isNaN(sent) || age < 0 || age > CRUNCH_PLAN_WINDOW_MS) return null;
  if (!parseDateOnly(data.week_start)) return null;
  return { weekStart: data.week_start, sentAt: data.sent_at };
}
