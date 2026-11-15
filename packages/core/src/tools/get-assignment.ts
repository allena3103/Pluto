import type { ToolContext } from "../context";
import {
  ASSIGNMENT_TEXT_CAP_CHARS,
  TOOLS,
  type ToolArgs,
  type ToolOutput,
} from "../contract";
import { assignmentFilePath, assignmentPath } from "../deep-links";
import { deadlineStatus, fetchAllRows, toDbToolError, toIsoNow } from "./shared";
import { ToolError } from "./tool-error";

export interface GetAssignmentOptions {
  textCapChars?: number;
}

interface AttachmentRow {
  id: string;
  title: string;
  file_type: string;
  ingest_status: string;
  page_count: number | null;
}

/** Page rows fetched per request; reading stops at the first range that reaches the text cap. */
const PAGE_BATCH = 50;

/**
 * One assignment with its instructions and the text of its ready attachments. The
 * instructions and every page share one text cap; once a page would pass it, no more
 * pages are added and `truncated` is set.
 */
export async function getAssignment(
  ctx: ToolContext,
  input: ToolArgs<"get_assignment">,
  options: GetAssignmentOptions = {},
): Promise<ToolOutput<"get_assignment">> {
  const cap = options.textCapChars ?? ASSIGNMENT_TEXT_CAP_CHARS;
  const { data: assignment, error } = await ctx.db
    .from("assignments")
    .select("id, title, due_at, graded, submitted, points_possible, course_id, description, courses!inner(name)")
    .eq("student_id", ctx.studentId)
    .eq("id", input.assignmentId)
    .maybeSingle();
  if (error) throw toDbToolError(error);
  if (!assignment) throw new ToolError("assignment_not_found", "Assignment not found.");

  const attachments = await fetchAllRows<AttachmentRow>(
    ctx.db
      .from("assignment_files")
      .select("id, title, file_type, ingest_status, page_count")
      .eq("student_id", ctx.studentId)
      .eq("assignment_id", assignment.id)
      .order("title", { ascending: true }),
  );

  let instructions = assignment.description;
  let truncated = false;
  if (instructions !== null && instructions.length > cap) {
    instructions = instructions.slice(0, cap);
    truncated = true;
  }
  let includedChars = instructions?.length ?? 0;

  // Pages are read attachment by attachment in output order, PAGE_BATCH rows at a time, and
  // reading stops at the first page that would pass the cap, so a huge file never loads whole.
  const output = [];
  for (const row of attachments) {
    const pages: Array<{ page: number; text: string }> = [];
    for (let from = 0; row.ingest_status === "ready" && !truncated; from += PAGE_BATCH) {
      const { data, error: pagesError } = await ctx.db
        .from("assignment_file_pages")
        .select("page_number, text")
        .eq("student_id", ctx.studentId)
        .eq("assignment_file_id", row.id)
        .order("page_number", { ascending: true })
        .range(from, from + PAGE_BATCH - 1);
      if (pagesError) throw toDbToolError(pagesError);
      for (const page of data ?? []) {
        const text = page.text ?? "";
        if (includedChars + text.length > cap) {
          truncated = true;
          break;
        }
        includedChars += text.length;
        pages.push({ page: page.page_number, text });
      }
      if (!data || data.length < PAGE_BATCH) break;
    }
    output.push({
      attachmentId: row.id,
      title: row.title,
      fileType: row.file_type,
      status: row.ingest_status,
      pageCount: row.page_count,
      url: `${ctx.appUrl}${assignmentFilePath(assignment.id, row.id)}`,
      pages,
    });
  }

  return TOOLS.get_assignment.output.parse({
    assignmentId: assignment.id,
    courseId: assignment.course_id,
    courseName: assignment.courses.name,
    title: assignment.title,
    dueAt: assignment.due_at,
    points: assignment.points_possible,
    status: deadlineStatus(assignment, toIsoNow()),
    instructions,
    url: `${ctx.appUrl}${assignmentPath(assignment.id)}`,
    attachments: output,
    truncated,
  });
}
