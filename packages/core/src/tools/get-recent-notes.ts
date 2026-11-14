import type { ToolContext } from "../context";
import {
  RECENT_NOTES_TEXT_CAP_CHARS,
  TOOLS,
  type ToolArgs,
  type ToolOutput,
} from "../contract";
import { resolveCourse } from "./resolve-course";
import { fetchAllRows, fetchFilePagesForFiles, pageDeepLink } from "./shared";

export interface GetRecentNotesOptions {
  textCapChars?: number;
}

export async function getRecentNotes(
  ctx: ToolContext,
  input: ToolArgs<"get_recent_notes">,
  options: GetRecentNotesOptions = {},
): Promise<ToolOutput<"get_recent_notes">> {
  const course = await resolveCourse(ctx, input.course);
  const cutoff = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000).toISOString();
  const cap = options.textCapChars ?? RECENT_NOTES_TEXT_CAP_CHARS;

  const files = await fetchAllRows<{
    id: string;
    title: string;
    week_label: string | null;
    added_at: string;
    page_count: number | null;
  }>(
    ctx.db
      .from("files")
      .select("id, title, week_label, added_at, page_count")
      .eq("student_id", ctx.studentId)
      .eq("course_id", course.courseId)
      .eq("ingest_status", "ready")
      .gte("added_at", cutoff)
      .order("added_at", { ascending: true })
      .order("id", { ascending: true }),
  );
  const pagesByFile = await fetchFilePagesForFiles(
    ctx,
    files.map((file) => file.id),
  );

  let includedChars = 0;
  let truncated = false;

  const outputFiles = files.map((file) => {
    const filePages = pagesByFile.get(file.id) ?? [];
    const pages: Array<{ page: number; text: string; deepLink: string }> = [];

    for (const entry of filePages) {
      // Once the cap is hit nothing more is included, so files after the cut have pagesIncluded 0.
      if (truncated) break;
      const text = entry.text;
      if (includedChars + text.length > cap) {
        truncated = true;
        break;
      }
      includedChars += text.length;
      pages.push({
        page: entry.pageNumber,
        text,
        deepLink: pageDeepLink(ctx, file.id, entry.pageNumber),
      });
    }

    const totalPageCount = file.page_count ?? filePages.length;
    if (pages.length < totalPageCount) truncated = true;

    return {
      fileId: file.id,
      title: file.title,
      weekLabel: file.week_label,
      addedAt: file.added_at,
      pageCount: totalPageCount,
      pagesIncluded: pages.length,
      deepLink: pageDeepLink(ctx, file.id, 1),
      pages,
    };
  });

  return TOOLS.get_recent_notes.output.parse({
    course,
    files: outputFiles,
    truncated,
  });
}
