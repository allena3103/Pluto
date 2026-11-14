import type { ToolContext } from "../context";
import { Id } from "../contract";
import { toDbToolError } from "./shared";
import { ToolError } from "./tool-error";

export interface ResolvedCourse {
  courseId: string;
  name: string;
  term: string | null;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function namesMessage(courses: Array<{ name: string }>): string {
  if (courses.length === 0) return "No courses are available for this student.";
  return `Available courses: ${courses.map((c) => c.name).join(", ")}`;
}

export function matchCourse(
  courses: ResolvedCourse[],
  courseRef: string,
): { kind: "ok"; course: ResolvedCourse } | { kind: "not_found"; message: string } | { kind: "ambiguous"; message: string } {
  const trimmed = courseRef.trim();
  const idLike = Id.safeParse(trimmed).success;
  if (idLike) {
    const byId = courses.find((course) => course.courseId === trimmed);
    if (byId) return { kind: "ok", course: byId };
  }

  const wanted = normalize(trimmed);
  const exact = courses.filter((course) => normalize(course.name) === wanted);
  if (exact.length === 1) return { kind: "ok", course: exact[0]! };
  if (exact.length > 1) {
    return {
      kind: "ambiguous",
      message: `Course "${courseRef}" matched multiple courses. ${namesMessage(courses)}`,
    };
  }

  const substring = courses.filter((course) => normalize(course.name).includes(wanted));
  if (substring.length === 1) return { kind: "ok", course: substring[0]! };
  if (substring.length > 1) {
    return {
      kind: "ambiguous",
      message: `Course "${courseRef}" is ambiguous. ${namesMessage(courses)}`,
    };
  }

  return {
    kind: "not_found",
    message: `Course "${courseRef}" was not found. ${namesMessage(courses)}`,
  };
}

export async function resolveCourse(ctx: ToolContext, courseRef: string): Promise<ResolvedCourse> {
  const { data, error } = await ctx.db
    .from("courses")
    .select("id, name, term")
    .eq("student_id", ctx.studentId)
    .order("name", { ascending: true })
    .limit(5000);
  if (error) throw toDbToolError(error);

  const courses: ResolvedCourse[] = (data ?? []).map((row) => ({
    courseId: row.id,
    name: row.name,
    term: row.term,
  }));

  const matched = matchCourse(courses, courseRef);
  if (matched.kind === "ok") return matched.course;
  if (matched.kind === "ambiguous") throw new ToolError("course_ambiguous", matched.message);
  throw new ToolError("course_not_found", matched.message);
}
