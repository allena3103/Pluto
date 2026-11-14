import type { ToolContext } from "../context";
import { TOOLS, type ToolOutput } from "../contract";
import { toDbToolError } from "./shared";

export async function listCourses(ctx: ToolContext): Promise<ToolOutput<"list_courses">> {
  const { data, error } = await ctx.db
    .from("courses")
    .select("id, name, term")
    .eq("student_id", ctx.studentId)
    .order("name", { ascending: true })
    .limit(5000);
  if (error) throw toDbToolError(error);

  return TOOLS.list_courses.output.parse({
    courses: (data ?? []).map((course) => ({
      courseId: course.id,
      name: course.name,
      term: course.term,
    })),
  });
}
