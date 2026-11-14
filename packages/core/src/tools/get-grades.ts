import type { ToolContext } from "../context";
import { TOOLS, type ToolArgs, type ToolOutput } from "../contract";
import { resolveCourse } from "./resolve-course";
import { fetchAllRows } from "./shared";

interface GroupRow {
  id: string;
  course_id: string;
  name: string;
  weight_percent: number;
}

interface AssignmentRow {
  course_id: string;
  grade_group_id: string | null;
  graded: boolean;
  points_possible: number | null;
  score: number | null;
}

interface CourseRow {
  id: string;
  name: string;
}

export interface ComputedGroupGrade {
  name: string;
  weightPercent: number;
  scorePercent: number | null;
  gradedCount: number;
  ungradedCount: number;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeGroupGrades(
  groups: GroupRow[],
  assignments: AssignmentRow[],
): { groups: ComputedGroupGrade[]; weightedGradePercent: number | null; ungradedCount: number } {
  const assignmentsByGroup = new Map<string, AssignmentRow[]>();
  for (const assignment of assignments) {
    if (!assignment.grade_group_id) continue;
    const rows = assignmentsByGroup.get(assignment.grade_group_id) ?? [];
    rows.push(assignment);
    assignmentsByGroup.set(assignment.grade_group_id, rows);
  }

  const computedGroups: ComputedGroupGrade[] = groups.map((group) => {
    const rows = assignmentsByGroup.get(group.id) ?? [];
    const graded = rows.filter((row) => row.graded);
    const ungradedCount = rows.length - graded.length;
    const numerator = graded.reduce((sum, row) => sum + (row.score ?? 0), 0);
    const denominator = graded.reduce((sum, row) => sum + (row.points_possible ?? 0), 0);
    const scorePercent = denominator > 0 ? (numerator / denominator) * 100 : null;
    return {
      name: group.name,
      weightPercent: round2(group.weight_percent),
      scorePercent: scorePercent === null ? null : round2(scorePercent),
      gradedCount: graded.length,
      ungradedCount,
    };
  });

  let weightedNumerator = 0;
  let weightedDenominator = 0;
  for (const group of computedGroups) {
    if (group.scorePercent === null || group.gradedCount === 0) continue;
    weightedNumerator += group.scorePercent * group.weightPercent;
    weightedDenominator += group.weightPercent;
  }

  return {
    groups: computedGroups,
    weightedGradePercent: weightedDenominator > 0 ? round2(weightedNumerator / weightedDenominator) : null,
    ungradedCount: computedGroups.reduce((sum, group) => sum + group.ungradedCount, 0),
  };
}

export async function getGrades(
  ctx: ToolContext,
  input: ToolArgs<"get_grades">,
): Promise<ToolOutput<"get_grades">> {
  const resolvedCourse = input.course ? await resolveCourse(ctx, input.course) : null;

  let courseQuery = ctx.db
    .from("courses")
    .select("id, name")
    .eq("student_id", ctx.studentId)
    .order("name", { ascending: true });
  if (resolvedCourse) courseQuery = courseQuery.eq("id", resolvedCourse.courseId);
  const courseRows = await fetchAllRows<CourseRow>(courseQuery);
  const courseIds = courseRows.map((course) => course.id);
  if (courseIds.length === 0) return { courses: [] };

  const groups = await fetchAllRows<GroupRow>(
    ctx.db
      .from("grade_groups")
      .select("id, course_id, name, weight_percent")
      .eq("student_id", ctx.studentId)
      .in("course_id", courseIds)
      .order("name", { ascending: true }),
  );

  const assignments = await fetchAllRows<AssignmentRow>(
    ctx.db
      .from("assignments")
      .select("course_id, grade_group_id, graded, points_possible, score")
      .eq("student_id", ctx.studentId)
      .in("course_id", courseIds),
  );

  const groupsByCourse = new Map<string, GroupRow[]>();
  for (const group of groups) {
    const rows = groupsByCourse.get(group.course_id) ?? [];
    rows.push(group);
    groupsByCourse.set(group.course_id, rows);
  }

  const assignmentsByCourse = new Map<string, AssignmentRow[]>();
  for (const assignment of assignments) {
    const rows = assignmentsByCourse.get(assignment.course_id) ?? [];
    rows.push(assignment);
    assignmentsByCourse.set(assignment.course_id, rows);
  }

  return TOOLS.get_grades.output.parse({
    courses: courseRows.map((course) => {
      const computed = computeGroupGrades(
        groupsByCourse.get(course.id) ?? [],
        assignmentsByCourse.get(course.id) ?? [],
      );
      return {
        courseId: course.id,
        courseName: course.name,
        groups: computed.groups,
        weightedGradePercent: computed.weightedGradePercent,
        ungradedCount: computed.ungradedCount,
      };
    }),
  });
}
