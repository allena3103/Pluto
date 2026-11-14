import type { ToolContext } from "../context";
import { TOOLS, type DeadlineStatus, type ToolArgs, type ToolOutput } from "../contract";
import { resolveCourse } from "./resolve-course";
import { fetchAllRows, toIsoNow } from "./shared";

interface DeadlineRow {
  id: string;
  due_at: string;
  previous_due_at: string | null;
  graded: boolean;
  submitted: boolean;
  points_possible: number | null;
  title: string;
  course_id: string;
  grade_groups: { name: string } | null;
  courses: { name: string };
}

function statusForDeadline(row: Pick<DeadlineRow, "graded" | "submitted" | "due_at">, nowIso: string): DeadlineStatus {
  if (row.graded) return "graded";
  if (row.submitted) return "submitted";
  if (row.due_at < nowIso) return "overdue";
  return "upcoming";
}

export async function getDeadlines(
  ctx: ToolContext,
  input: ToolArgs<"get_deadlines">,
): Promise<ToolOutput<"get_deadlines">> {
  const nowIso = toIsoNow();
  const horizonIso = new Date(Date.now() + input.daysAhead * 24 * 60 * 60 * 1000).toISOString();
  const resolvedCourse = input.course ? await resolveCourse(ctx, input.course) : null;

  let query = ctx.db
    .from("assignments")
    .select(
      "id, title, due_at, previous_due_at, graded, submitted, points_possible, course_id, grade_groups(name), courses!inner(name)",
    )
    .eq("student_id", ctx.studentId)
    .not("due_at", "is", null)
    .gte("due_at", nowIso)
    .lte("due_at", horizonIso)
    .order("due_at", { ascending: true })
    .order("id", { ascending: true });

  if (resolvedCourse) query = query.eq("course_id", resolvedCourse.courseId);

  const data = await fetchAllRows<DeadlineRow>(query);

  return TOOLS.get_deadlines.output.parse({
    deadlines: data.map((row) => ({
      assignmentId: row.id,
      courseId: row.course_id,
      courseName: row.courses.name,
      title: row.title,
      dueAt: row.due_at,
      previousDueAt:
        row.previous_due_at && row.previous_due_at !== row.due_at ? row.previous_due_at : null,
      points: row.points_possible,
      weightGroup: row.grade_groups?.name ?? null,
      status: statusForDeadline(row, nowIso),
    })),
  });
}
