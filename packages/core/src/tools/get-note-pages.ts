import type { ToolContext } from "../context";
import {
  RECENT_NOTES_TEXT_CAP_CHARS,
  TOOLS,
  type ToolArgs,
  type ToolOutput,
} from "../contract";
import { fetchPagesForFileRange, pageDeepLink, toDbToolError } from "./shared";
import { ToolError } from "./tool-error";

export interface GetNotePagesOptions {
  textCapChars?: number;
}

export async function getNotePages(
  ctx: ToolContext,
  input: ToolArgs<"get_note_pages">,
  options: GetNotePagesOptions = {},
): Promise<ToolOutput<"get_note_pages">> {
  const cap = options.textCapChars ?? RECENT_NOTES_TEXT_CAP_CHARS;
  const { data: file, error: fileError } = await ctx.db
    .from("files")
    .select("id, title, course_id, page_count, courses!inner(name)")
    .eq("student_id", ctx.studentId)
    .eq("id", input.fileId)
    .maybeSingle();
  if (fileError) throw toDbToolError(fileError);
  if (!file) throw new ToolError("file_not_found", "File not found.");

  const pageCount = file.page_count ?? 0;
  const firstPage = input.firstPage ?? 1;
  const lastPage = input.lastPage ?? pageCount;
  const deepLinkPage = firstPage <= pageCount ? firstPage : 1;

  if (firstPage > pageCount || firstPage > lastPage) {
    return TOOLS.get_note_pages.output.parse({
      fileId: file.id,
      title: file.title,
      courseId: file.course_id,
      courseName: file.courses.name,
      pageCount,
      deepLink: pageDeepLink(ctx, file.id, deepLinkPage),
      pages: [],
      truncated: false,
    });
  }

  const rows = await fetchPagesForFileRange(ctx, file.id, firstPage, lastPage);
  const rangeLast = Math.min(lastPage, pageCount);
  const expectedPages = rangeLast >= firstPage ? rangeLast - firstPage + 1 : 0;
  let includedChars = 0;
  let truncated = false;
  const pages: Array<{ page: number; text: string; deepLink: string }> = [];

  for (const row of rows) {
    const fits = includedChars + row.text.length <= cap;
    if (!fits && pages.length === 0) {
      pages.push({
        page: row.pageNumber,
        text: row.text.slice(0, cap),
        deepLink: pageDeepLink(ctx, file.id, row.pageNumber),
      });
      truncated = true;
      break;
    }
    if (!fits) {
      truncated = true;
      break;
    }
    includedChars += row.text.length;
    pages.push({
      page: row.pageNumber,
      text: row.text,
      deepLink: pageDeepLink(ctx, file.id, row.pageNumber),
    });
  }

  if (pages.length < expectedPages) truncated = true;

  return TOOLS.get_note_pages.output.parse({
    fileId: file.id,
    title: file.title,
    courseId: file.course_id,
    courseName: file.courses.name,
    pageCount,
    deepLink: pageDeepLink(ctx, file.id, pages[0]?.page ?? deepLinkPage),
    pages,
    truncated,
  });
}
