// Moves assignment attachments (PDF and Word) into the private `assignment-files` bucket and
// reads their text into `assignment_file_pages`. `syncCanvas` writes the `assignment_files`
// rows (pdf/docx `pending`, anything else `skipped`); this module moves the bytes. Kept apart
// from notes: nothing here reads or writes `files` / `file_pages`.
//
// Skip rule: a row is current when it is `ready` with its `storage_path` set, its object exists,
// and the object was written at or after the row's `canvas_updated_at`. So a second sync
// downloads nothing, and a file edited in Canvas after our upload is downloaded again.
//
// Canvas download URLs are capability links (they work without auth). Each one is read fresh
// from the file's metadata right before its download and only ever held in memory.

import type { PlutoDb } from "@pluto/core/context";
import {
  ASSIGNMENT_FILES_BUCKET,
  ingestAssignmentFile,
  MAX_READ_ATTEMPTS,
  type AssignmentDocumentType,
} from "@pluto/core/assignment-ingest";
import type { CanvasClient } from "./client";
import { downloadCanvasFile, type FilesSyncDeps, type FilesSyncResult } from "./files-sync";
import { errorText } from "./map";
import { CanvasAuthError, CanvasRateLimitError } from "./types";

// Files already done are skipped without using the cap, so a capped or timed-out run resumes next sync.
const DEFAULT_MAX_FILES = 50;
const PAGE_SIZE = 1000;

export type AssignmentFilesSyncResult = FilesSyncResult;

export type AssignmentFilesSyncDeps = {
  /** Service-role client. Every read and write is filtered by `studentId`. */
  admin: PlutoDb;
  studentId: string;
  client: CanvasClient;
  /** Same rules as the notes files step: the token goes only to `baseUrl`'s host. */
  download: FilesSyncDeps["download"];
  ingest?: typeof ingestAssignmentFile;
};

export type AssignmentFilesSyncOptions = {
  maxFiles?: number;
  /** Epoch ms. No download starts after it; the rest wait for the next sync. */
  deadline?: number;
};

type AttachmentRow = {
  id: string;
  assignment_id: string;
  canvas_file_id: string;
  file_type: AssignmentDocumentType;
  ingest_status: string;
  canvas_updated_at: string | null;
  storage_path: string | null;
  ingest_attempts: number;
};

export async function syncAssignmentFiles(
  deps: AssignmentFilesSyncDeps,
  options: AssignmentFilesSyncOptions = {},
): Promise<AssignmentFilesSyncResult> {
  if (!deps.studentId) throw new TypeError("studentId is required");
  const { admin, studentId } = deps;
  const result: AssignmentFilesSyncResult = { downloaded: 0, ingested: 0, skipped: 0, failed: 0, errors: [] };

  const rows = await loadRows(admin, studentId, result);
  if (!rows || rows.length === 0) return result;
  const uploadedAt = await loadUploadTimes(admin, studentId, result);
  if (!uploadedAt) return result;

  // Never-read rows first, failed ones last, so a file that keeps failing can't hold up the
  // rest. The sort is stable: oldest first within a group. A file whose text could not be read
  // after MAX_READ_ATTEMPTS tries waits for a newer version from Canvas (sync resets the count).
  const order = (row: AttachmentRow) => (row.ingest_status === "pending" ? 0 : row.ingest_status === "failed" ? 2 : 1);
  const due = rows
    .filter((row) => !isCurrent(row, uploadedAt.get(`${row.id}.${row.file_type}`)))
    .filter((row) => !(row.ingest_status === "failed" && row.ingest_attempts >= MAX_READ_ATTEMPTS))
    .sort((a, b) => order(a) - order(b));
  const batch = due.slice(0, options.maxFiles ?? DEFAULT_MAX_FILES);
  result.skipped += rows.length - batch.length;
  if (batch.length === 0) return result;

  const canvasCourseByAssignment = await loadCanvasCourses(admin, studentId, batch, result);
  if (!canvasCourseByAssignment) return result;

  const ingest = deps.ingest ?? ingestAssignmentFile;
  for (const [index, row] of batch.entries()) {
    if (options.deadline !== undefined && Date.now() >= options.deadline) {
      result.skipped += batch.length - index;
      result.errors.push("Attachment downloads stopped at the time limit; the rest continue next sync");
      break;
    }
    const stop = await syncOne(deps, ingest, row, canvasCourseByAssignment.get(row.assignment_id), result);
    if (stop) {
      result.skipped += batch.length - index - 1;
      break;
    }
  }
  return result;
}

function isCurrent(row: AttachmentRow, uploaded: number | undefined): boolean {
  if (row.ingest_status !== "ready" || row.storage_path === null || uploaded === undefined) return false;
  if (!row.canvas_updated_at) return true;
  const canvasUpdated = Date.parse(row.canvas_updated_at);
  return Number.isNaN(canvasUpdated) || uploaded >= canvasUpdated;
}

async function loadRows(
  admin: PlutoDb,
  studentId: string,
  result: AssignmentFilesSyncResult,
): Promise<AttachmentRow[] | null> {
  const rows: AttachmentRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("assignment_files")
      .select("id, assignment_id, canvas_file_id, file_type, ingest_status, canvas_updated_at, storage_path, ingest_attempts")
      .eq("student_id", studentId)
      .in("file_type", ["pdf", "docx"])
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      result.errors.push(`assignment files: ${errorText(error)}`);
      return null;
    }
    rows.push(...((data ?? []) as AttachmentRow[]));
    if ((data ?? []).length < PAGE_SIZE) return rows;
  }
}

/** When each of the student's objects was last written, keyed by object name (`<id>.<type>`). */
async function loadUploadTimes(
  admin: PlutoDb,
  studentId: string,
  result: AssignmentFilesSyncResult,
): Promise<Map<string, number> | null> {
  const times = new Map<string, number>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin.storage
      .from(ASSIGNMENT_FILES_BUCKET)
      .list(studentId, { limit: PAGE_SIZE, offset });
    if (error) {
      result.errors.push(`storage: ${errorText(error)}`);
      return null;
    }
    for (const object of data ?? []) {
      const stamp = Date.parse(object.updated_at ?? object.created_at ?? "");
      if (!Number.isNaN(stamp)) times.set(object.name, stamp);
    }
    if ((data ?? []).length < PAGE_SIZE) return times;
  }
}

/** Canvas course id per assignment id, for the rows about to be downloaded. */
async function loadCanvasCourses(
  admin: PlutoDb,
  studentId: string,
  rows: AttachmentRow[],
  result: AssignmentFilesSyncResult,
): Promise<Map<string, string> | null> {
  const assignmentIds = [...new Set(rows.map((row) => row.assignment_id))];
  const { data: assignments, error: assignmentsError } = await admin
    .from("assignments")
    .select("id, course_id")
    .eq("student_id", studentId)
    .in("id", assignmentIds);
  if (assignmentsError) {
    result.errors.push(`assignments: ${errorText(assignmentsError)}`);
    return null;
  }
  const courseIds = [...new Set((assignments ?? []).map((row) => row.course_id))];
  const { data: courses, error: coursesError } = await admin
    .from("courses")
    .select("id, canvas_course_id")
    .eq("student_id", studentId)
    .in("id", courseIds);
  if (coursesError) {
    result.errors.push(`courses: ${errorText(coursesError)}`);
    return null;
  }
  const canvasByCourse = new Map((courses ?? []).map((row) => [row.id, row.canvas_course_id]));
  const out = new Map<string, string>();
  for (const row of assignments ?? []) {
    const canvasCourseId = canvasByCourse.get(row.course_id);
    if (canvasCourseId) out.set(row.id, canvasCourseId);
  }
  return out;
}

/** Downloads and ingests one row. True when Canvas refused the token or throttled us: stop the run. */
async function syncOne(
  deps: AssignmentFilesSyncDeps,
  ingest: typeof ingestAssignmentFile,
  row: AttachmentRow,
  canvasCourseId: string | undefined,
  result: AssignmentFilesSyncResult,
): Promise<boolean> {
  const { admin, studentId } = deps;
  const label = `attachment ${row.canvas_file_id}`;
  try {
    if (!canvasCourseId) throw new Error("its course has no Canvas id");
    const file = await deps.client.getCourseFile(canvasCourseId, row.canvas_file_id);
    if (!file) throw new Error("file is no longer available in Canvas");
    const bytes = await downloadCanvasFile(file.url, deps.download, row.file_type);
    result.downloaded += 1;

    const ingested = await ingest(admin, { studentId, assignmentFileId: row.id, bytes, fileType: row.file_type });
    if (ingested?.status === "ready") {
      result.ingested += 1;
      return false;
    }
    // ingestAssignmentFile already recorded `failed` on the row.
    result.failed += 1;
    result.errors.push(`${label}: ingest ${ingested ? `failed: ${ingested.error ?? "unknown"}` : "found no row"}`);
    return false;
  } catch (error) {
    const message = errorText(error);
    result.failed += 1;
    result.errors.push(`${label}: ${message}`);
    const { error: markError } = await admin
      .from("assignment_files")
      .update({ ingest_status: "failed", ingest_error: message, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("student_id", studentId);
    if (markError) result.errors.push(`${label}: could not record failure: ${errorText(markError)}`);
    return error instanceof CanvasAuthError || error instanceof CanvasRateLimitError;
  }
}
