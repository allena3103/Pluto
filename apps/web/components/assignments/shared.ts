import type { DeadlineStatus } from "@pluto/core/contract";

/** Assignment and attachment ids are uuids; anything else is a not-found, not a DB error. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AttachmentFileType = "pdf" | "docx" | "other";
export type AttachmentStatus = "pending" | "ready" | "failed" | "skipped";

export function fileTypeLabel(fileType: AttachmentFileType): string {
  if (fileType === "pdf") return "PDF";
  if (fileType === "docx") return "Word";
  return "Other file";
}

/** Same rule as get_deadlines. */
export function assignmentStatus(
  row: { graded: boolean; submitted: boolean; due_at: string | null },
  nowIso: string,
): DeadlineStatus {
  if (row.graded) return "graded";
  if (row.submitted) return "submitted";
  if (row.due_at && row.due_at < nowIso) return "overdue";
  return "upcoming";
}

/** Only https links leave Pluto (the column has the same check). */
export function safeCanvasUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** `?page=` as a 1-based page; null when it is malformed or past the last page. */
export function parsePageParam(raw: string | string[] | undefined, pageCount: number | null): number | null {
  if (raw === undefined) return 1;
  if (Array.isArray(raw) || !/^[1-9]\d*$/.test(raw)) return null;
  const page = Number(raw);
  if (!Number.isSafeInteger(page)) return null;
  if (pageCount !== null && page > pageCount) return null;
  return page;
}
