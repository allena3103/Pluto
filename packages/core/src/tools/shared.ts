import { noteUrl } from "../deep-links";
import type { ToolContext } from "../context";
import { ToolError } from "./tool-error";

const PAGE_SIZE = 1000;

export interface FilePageRow {
  file_id: string;
  page_number: number;
  text: string | null;
}

export function normalizeErrorMessage(error: unknown): string {
  const fallback = "Database query failed.";
  if (!error || typeof error !== "object") return fallback;
  const message = "message" in error ? (error as { message?: unknown }).message : undefined;
  if (typeof message !== "string" || !message.trim()) return fallback;
  return message.split("\n")[0]!.trim();
}

export function toDbToolError(error: unknown): ToolError {
  return new ToolError("db_error", normalizeErrorMessage(error));
}

export function toIsoNow(): string {
  return new Date().toISOString();
}

export function pageDeepLink(ctx: ToolContext, fileId: string, page: number): string {
  return noteUrl(ctx.appUrl, fileId, page);
}

export async function fetchFilePagesForFiles(
  ctx: ToolContext,
  fileIds: string[],
): Promise<Map<string, Array<{ pageNumber: number; text: string }>>> {
  const byFile = new Map<string, Array<{ pageNumber: number; text: string }>>();
  if (fileIds.length === 0) return byFile;

  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await ctx.db
      .from("file_pages")
      .select("file_id, page_number, text")
      .eq("student_id", ctx.studentId)
      .in("file_id", fileIds)
      .order("file_id", { ascending: true })
      .order("page_number", { ascending: true })
      .range(from, to);

    if (error) throw toDbToolError(error);
    if (!data || data.length === 0) break;

    for (const row of data as FilePageRow[]) {
      const arr = byFile.get(row.file_id) ?? [];
      arr.push({
        pageNumber: row.page_number,
        text: row.text ?? "",
      });
      byFile.set(row.file_id, arr);
    }

    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return byFile;
}

export async function fetchPagesForFileRange(
  ctx: ToolContext,
  fileId: string,
  firstPage: number,
  lastPage: number,
): Promise<Array<{ pageNumber: number; text: string }>> {
  const rows: Array<{ pageNumber: number; text: string }> = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await ctx.db
      .from("file_pages")
      .select("page_number, text")
      .eq("student_id", ctx.studentId)
      .eq("file_id", fileId)
      .gte("page_number", firstPage)
      .lte("page_number", lastPage)
      .order("page_number", { ascending: true })
      .range(from, to);

    if (error) throw toDbToolError(error);
    if (!data || data.length === 0) break;

    for (const row of data as Array<{ page_number: number; text: string | null }>) {
      rows.push({ pageNumber: row.page_number, text: row.text ?? "" });
    }

    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}
