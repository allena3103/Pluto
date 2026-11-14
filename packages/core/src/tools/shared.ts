import { noteUrl } from "../deep-links";
import type { ToolContext } from "../context";
import { ToolError } from "./tool-error";

const PAGE_SIZE = 1000;
const MAX_ROWS = 20_000;

export interface FilePageRow {
  file_id: string;
  page_number: number;
  text: string | null;
}

type PageResult<T> = { data: T[] | null; error: unknown };

/**
 * A filtered query. `fetchAllRows` adds `id` as the last sort key and reads
 * every row with `.range()` so PostgREST's 1,000-row cap does not drop the rest.
 */
export interface PagedQuery<T> {
  order(column: string, options?: { ascending?: boolean }): PagedQuery<T>;
  range(from: number, to: number): PromiseLike<PageResult<T>>;
}

/**
 * Database errors never reach the caller verbatim: Postgres messages can quote row values or SQL.
 * The caller gets a generic message; the original is kept on `cause` for server logs.
 */
export function toDbToolError(error: unknown): ToolError {
  const toolError = new ToolError("db_error", "Database query failed.");
  (toolError as Error & { cause?: unknown }).cause = error;
  return toolError;
}

export function toIsoNow(): string {
  return new Date().toISOString();
}

export function pageDeepLink(ctx: ToolContext, fileId: string, page: number): string {
  return noteUrl(ctx.appUrl, fileId, page);
}

export async function fetchAllRows<T>(query: PagedQuery<T>): Promise<T[]> {
  const ordered = query.order("id", { ascending: true });
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await ordered.range(from, to);
    if (error) throw toDbToolError(error);
    if (!data || data.length === 0) break;

    rows.push(...data);
    if (rows.length > MAX_ROWS) {
      throw new ToolError("db_error", "Query exceeded 20000 rows.");
    }
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

export async function fetchFilePagesForFiles(
  ctx: ToolContext,
  fileIds: string[],
): Promise<Map<string, Array<{ pageNumber: number; text: string }>>> {
  const byFile = new Map<string, Array<{ pageNumber: number; text: string }>>();
  if (fileIds.length === 0) return byFile;

  const data = await fetchAllRows<FilePageRow>(
    ctx.db
      .from("file_pages")
      .select("file_id, page_number, text")
      .eq("student_id", ctx.studentId)
      .in("file_id", fileIds)
      .order("file_id", { ascending: true })
      .order("page_number", { ascending: true }),
  );

  for (const row of data) {
    const arr = byFile.get(row.file_id) ?? [];
    arr.push({
      pageNumber: row.page_number,
      text: row.text ?? "",
    });
    byFile.set(row.file_id, arr);
  }

  return byFile;
}

export async function fetchPagesForFileRange(
  ctx: ToolContext,
  fileId: string,
  firstPage: number,
  lastPage: number,
): Promise<Array<{ pageNumber: number; text: string }>> {
  const data = await fetchAllRows<{ page_number: number; text: string | null }>(
    ctx.db
      .from("file_pages")
      .select("page_number, text")
      .eq("student_id", ctx.studentId)
      .eq("file_id", fileId)
      .gte("page_number", firstPage)
      .lte("page_number", lastPage)
      .order("page_number", { ascending: true }),
  );

  return data.map((row) => ({ pageNumber: row.page_number, text: row.text ?? "" }));
}
