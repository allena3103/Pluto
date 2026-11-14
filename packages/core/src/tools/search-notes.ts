import type { ToolContext } from "../context";
import { TOOLS, type ToolArgs, type ToolOutput } from "../contract";
import { resolveCourse } from "./resolve-course";
import { pageDeepLink, toDbToolError } from "./shared";

interface SearchNotesRow {
  file_id: string;
  file_title: string;
  course_id: string;
  course_name: string;
  week_label: string | null;
  page_number: number;
  snippet: string;
}

export async function searchNotes(
  ctx: ToolContext,
  input: ToolArgs<"search_notes">,
): Promise<ToolOutput<"search_notes">> {
  const query = input.query.trim();
  if (!query) return { results: [] };

  const resolvedCourse = input.course ? await resolveCourse(ctx, input.course) : null;
  const { data, error } = await ctx.db.rpc("search_notes", {
    p_student_id: ctx.studentId,
    p_query: query,
    p_course_id: resolvedCourse?.courseId,
    p_limit: input.limit,
  });

  if (error) throw toDbToolError(error);

  return TOOLS.search_notes.output.parse({
    results: ((data ?? []) as SearchNotesRow[]).map((row) => ({
      fileId: row.file_id,
      title: row.file_title,
      courseId: row.course_id,
      courseName: row.course_name,
      weekLabel: row.week_label,
      page: row.page_number,
      snippet: row.snippet,
      deepLink: pageDeepLink(ctx, row.file_id, row.page_number),
    })),
  });
}
