import type { ToolContext } from "../context";
import { TOOLS, type ToolOutput } from "../contract";
import { fetchAllRows } from "./shared";

export async function listCourses(ctx: ToolContext): Promise<ToolOutput<"list_courses">> {
  const data = await fetchAllRows<{ id: string; name: string; term: string | null }>(
    ctx.db
      .from("courses")
      .select("id, name, term")
      .eq("student_id", ctx.studentId)
      .order("name", { ascending: true }),
  );

  return TOOLS.list_courses.output.parse({
    courses: data.map((course) => ({
      courseId: course.id,
      name: course.name,
      term: course.term,
    })),
  });
}
