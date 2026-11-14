import type { ToolContext } from "../context";
import { TOOLS, type ToolArgs, type ToolOutput } from "../contract";
import { toDbToolError, toIsoNow } from "./shared";

interface AssignmentRow {
  id: string;
  course_id: string;
  title: string;
  due_at: string;
  previous_due_at: string | null;
  graded: boolean;
  submitted: boolean;
  points_possible: number | null;
  grade_group_id: string | null;
  courses: { name: string };
  grade_groups: { name: string; weight_percent: number } | null;
}

export interface CrunchWeekDraft {
  weekStart: string;
  weekEnd: string;
  deliverableCount: number;
  totalWeightPercent: number;
  score: number;
  assignments: ToolOutput<"get_deadlines">["deadlines"];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

// Weeks are Monday-start in UTC to keep consistent boundaries across environments.
export function utcMondayStart(input: Date): Date {
  const date = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  const day = date.getUTCDay();
  const shift = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - shift);
  return date;
}

export function buildCrunchWeeks(
  rows: AssignmentRow[],
  groupPointTotals: Map<string, number>,
): CrunchWeekDraft[] {
  const nowIso = toIsoNow();
  const weeks = new Map<string, CrunchWeekDraft>();

  for (const row of rows) {
    const dueDate = new Date(row.due_at);
    const weekStartDate = utcMondayStart(dueDate);
    const weekStart = isoDate(weekStartDate);
    const weekEnd = isoDate(new Date(weekStartDate.getTime() + 6 * DAY_MS));

    const draft = weeks.get(weekStart) ?? {
      weekStart,
      weekEnd,
      deliverableCount: 0,
      totalWeightPercent: 0,
      score: 0,
      assignments: [],
    };

    draft.deliverableCount += 1;

    let share = 0;
    if (row.grade_group_id && row.points_possible && row.points_possible > 0 && row.grade_groups) {
      const groupTotal = groupPointTotals.get(row.grade_group_id) ?? 0;
      if (groupTotal > 0) {
        share = (row.grade_groups.weight_percent * row.points_possible) / groupTotal;
      }
    }
    draft.totalWeightPercent += share;

    draft.assignments.push({
      assignmentId: row.id,
      courseId: row.course_id,
      courseName: row.courses.name,
      title: row.title,
      dueAt: row.due_at,
      previousDueAt:
        row.previous_due_at && row.previous_due_at !== row.due_at ? row.previous_due_at : null,
      points: row.points_possible,
      weightGroup: row.grade_groups?.name ?? null,
      status: row.graded ? "graded" : row.submitted ? "submitted" : row.due_at < nowIso ? "overdue" : "upcoming",
    });
    weeks.set(weekStart, draft);
  }

  const ranked = [...weeks.values()];
  for (const week of ranked) {
    week.totalWeightPercent = Math.round(week.totalWeightPercent * 100) / 100;
    week.score = Math.round((week.deliverableCount + week.totalWeightPercent) * 100) / 100;
    week.assignments.sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.assignmentId.localeCompare(b.assignmentId));
  }

  ranked.sort((a, b) => b.score - a.score || a.weekStart.localeCompare(b.weekStart));
  return ranked;
}

export async function getCrunchWeeks(
  ctx: ToolContext,
  input: ToolArgs<"get_crunch_weeks">,
): Promise<ToolOutput<"get_crunch_weeks">> {
  const nowIso = toIsoNow();
  const horizon = new Date(Date.now() + input.weeksAhead * 7 * DAY_MS).toISOString();

  const { data: assignments, error: assignmentsError } = await ctx.db
    .from("assignments")
    .select(
      "id, title, due_at, previous_due_at, graded, submitted, points_possible, course_id, grade_group_id, courses!inner(name), grade_groups(name, weight_percent)",
    )
    .eq("student_id", ctx.studentId)
    .not("due_at", "is", null)
    .gte("due_at", nowIso)
    .lte("due_at", horizon)
    .order("due_at", { ascending: true })
    .limit(10000);
  if (assignmentsError) throw toDbToolError(assignmentsError);

  const rows = (assignments ?? []) as AssignmentRow[];
  const groupIds = [...new Set(rows.map((row) => row.grade_group_id).filter((id): id is string => Boolean(id)))];

  const groupTotals = new Map<string, number>();
  if (groupIds.length > 0) {
    const { data: totals, error: totalsError } = await ctx.db
      .from("assignments")
      .select("grade_group_id, points_possible")
      .eq("student_id", ctx.studentId)
      .in("grade_group_id", groupIds)
      .limit(10000);
    if (totalsError) throw toDbToolError(totalsError);
    for (const row of (totals ?? []) as Array<{ grade_group_id: string | null; points_possible: number | null }>) {
      if (!row.grade_group_id) continue;
      groupTotals.set(
        row.grade_group_id,
        (groupTotals.get(row.grade_group_id) ?? 0) + (row.points_possible ?? 0),
      );
    }
  }

  const drafts = buildCrunchWeeks(rows, groupTotals);
  return TOOLS.get_crunch_weeks.output.parse({
    weeks: drafts.map((week, index) => ({
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      deliverableCount: week.deliverableCount,
      totalWeightPercent: week.totalWeightPercent,
      score: week.score,
      rank: index + 1,
      assignments: week.assignments,
    })),
  });
}
