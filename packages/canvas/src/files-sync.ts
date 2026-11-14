// Moves synced Canvas PDFs into Storage and ingests them into `file_pages`.
// `syncCanvas` only writes the `files` rows (status `pending`); this module moves the bytes.
//
// Skip rule (no new column): a row is skipped when it is `ready`, its object exists in the
// `notes` bucket, and the object was written at or after the file's Canvas `updated_at`
// (taken from the live listing). So a second sync downloads nothing, and a file edited in
// Canvas after our upload is downloaded again.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PlutoDb } from "@pluto/core/context";
import { ingestFile, NOTES_BUCKET } from "@pluto/core/ingest";
import type { CanvasClient } from "./client";
import { errorText, fileStoragePath } from "./map";
import type { CanvasCourseFile } from "./types";

export const FILE_DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const FILE_DOWNLOAD_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_FILES = 25;
const MAX_REDIRECTS = 3;
const PDF_CONTENT_TYPES = new Set(["application/pdf", "application/x-pdf"]);
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

export type FilesSyncResult = {
  downloaded: number;
  ingested: number;
  skipped: number;
  failed: number;
  errors: string[];
};

export type FilesSyncDeps = {
  /** Service-role client. Every read and write is filtered by `studentId`. */
  admin: PlutoDb;
  studentId: string;
  client: CanvasClient;
  /**
   * How to fetch file bytes. The token is sent only to `baseUrl`'s host.
   * Omit `token` (fixtures mode) to never send an Authorization header.
   */
  download: { baseUrl: string; token?: string; fetch?: typeof fetch };
  now?: Date;
  ingest?: typeof ingestFile;
};

export type FilesSyncOptions = { maxFiles?: number };

type FileRow = {
  id: string;
  course_id: string;
  canvas_file_id: string | null;
  storage_path: string | null;
  ingest_status: string;
};

class DownloadError extends Error {}

export async function syncCanvasFiles(
  deps: FilesSyncDeps,
  options: FilesSyncOptions = {},
): Promise<FilesSyncResult> {
  if (!deps.studentId) throw new TypeError("studentId is required");
  const { admin, studentId } = deps;
  const ingest = deps.ingest ?? ingestFile;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const result: FilesSyncResult = { downloaded: 0, ingested: 0, skipped: 0, failed: 0, errors: [] };

  const { data: rows, error: rowsError } = await admin
    .from("files")
    .select("id, course_id, canvas_file_id, storage_path, ingest_status")
    .eq("student_id", studentId)
    .eq("source", "canvas");
  if (rowsError) {
    result.errors.push(`files: ${errorText(rowsError)}`);
    return result;
  }
  const fileRows = (rows ?? []) as FileRow[];
  if (fileRows.length === 0) return result;

  const listing = await loadListing(deps, fileRows, result);
  if (!listing) return result;
  const uploadedAt = await loadUploadTimes(admin, studentId, result);
  if (!uploadedAt) return result;

  let attempted = 0;
  for (const row of fileRows) {
    const canvasFile = row.canvas_file_id ? listing.get(row.canvas_file_id) : undefined;
    if (!canvasFile) {
      // Gone from Canvas (or its course listing failed): leave the row as it is.
      result.skipped += 1;
      continue;
    }
    if (isCurrent(row, canvasFile, uploadedAt.get(row.id))) {
      result.skipped += 1;
      continue;
    }
    if (attempted >= maxFiles) {
      result.skipped += 1;
      continue;
    }
    attempted += 1;
    await syncOne(deps, ingest, row, canvasFile, result);
  }

  return result;
}

function isCurrent(row: FileRow, file: CanvasCourseFile, uploaded: number | undefined): boolean {
  if (row.ingest_status !== "ready" || uploaded === undefined) return false;
  if (!file.updatedAt) return true;
  const canvasUpdated = Date.parse(file.updatedAt);
  return Number.isNaN(canvasUpdated) || uploaded >= canvasUpdated;
}

async function loadListing(
  deps: FilesSyncDeps,
  rows: FileRow[],
  result: FilesSyncResult,
): Promise<Map<string, CanvasCourseFile> | null> {
  const courseIds = [...new Set(rows.map((row) => row.course_id))];
  const { data: courses, error } = await deps.admin
    .from("courses")
    .select("id, canvas_course_id")
    .eq("student_id", deps.studentId)
    .in("id", courseIds);
  if (error) {
    result.errors.push(`courses: ${errorText(error)}`);
    return null;
  }

  const listing = new Map<string, CanvasCourseFile>();
  for (const course of courses ?? []) {
    if (!course.canvas_course_id) continue;
    try {
      for (const file of await deps.client.listCourseFiles(course.canvas_course_id)) {
        if (file.canvasFileId) listing.set(file.canvasFileId, file);
      }
    } catch (listError) {
      result.errors.push(`files ${course.canvas_course_id}: ${errorText(listError)}`);
    }
  }
  return listing;
}

/** When each of the student's objects was last written, keyed by file id. */
async function loadUploadTimes(
  admin: PlutoDb,
  studentId: string,
  result: FilesSyncResult,
): Promise<Map<string, number> | null> {
  const times = new Map<string, number>();
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin.storage
      .from(NOTES_BUCKET)
      .list(studentId, { limit: pageSize, offset });
    if (error) {
      result.errors.push(`storage: ${errorText(error)}`);
      return null;
    }
    for (const object of data ?? []) {
      if (!object.name.endsWith(".pdf")) continue;
      const stamp = Date.parse(object.updated_at ?? object.created_at ?? "");
      if (!Number.isNaN(stamp)) times.set(object.name.slice(0, -".pdf".length), stamp);
    }
    if ((data ?? []).length < pageSize) return times;
  }
}

async function syncOne(
  deps: FilesSyncDeps,
  ingest: typeof ingestFile,
  row: FileRow,
  file: CanvasCourseFile,
  result: FilesSyncResult,
): Promise<void> {
  const { admin, studentId } = deps;
  const label = file.canvasFileId;
  const expectedPath = fileStoragePath(studentId, row.id);

  try {
    if (row.storage_path !== expectedPath) {
      throw new DownloadError("storage path does not match <student_id>/<file_id>.pdf");
    }

    const bytes = await downloadPdf(file.url, deps.download);
    result.downloaded += 1;

    const { error: uploadError } = await admin.storage
      .from(NOTES_BUCKET)
      .upload(expectedPath, bytes, { contentType: "application/pdf", upsert: true });
    if (uploadError) throw new DownloadError(`upload failed: ${errorText(uploadError)}`);

    const ingested = await ingest(admin, row.id);
    if (ingested?.status === "ready") {
      result.ingested += 1;
      return;
    }
    // ingestFile already recorded `failed` on the row.
    result.failed += 1;
    result.errors.push(`file ${label}: ingest ${ingested ? `failed: ${ingested.error ?? "unknown"}` : "found no row"}`);
  } catch (error) {
    const message = error instanceof DownloadError ? error.message : errorText(error);
    result.failed += 1;
    result.errors.push(`file ${label}: ${message}`);
    await markFailed(admin, studentId, row.id, message, result);
  }
}

async function markFailed(
  admin: PlutoDb,
  studentId: string,
  fileId: string,
  message: string,
  result: FilesSyncResult,
): Promise<void> {
  const { error } = await admin
    .from("files")
    .update({ ingest_status: "failed", ingest_error: message.slice(0, 300) })
    .eq("id", fileId)
    .eq("student_id", studentId);
  if (error) result.errors.push(`file ${fileId}: could not record failure: ${errorText(error)}`);
}

function sameHost(url: URL, baseUrl: string): boolean {
  try {
    const base = new URL(baseUrl);
    return url.protocol === base.protocol && url.host.toLowerCase() === base.host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * GETs a Canvas file. Follows up to three redirects by hand so the token is only ever
 * sent to the configured Canvas host. Errors never include the URL (it may be signed).
 */
export async function downloadPdf(
  rawUrl: string,
  download: FilesSyncDeps["download"],
): Promise<Uint8Array> {
  const fetchImpl = download.fetch ?? fetch;
  const signal = AbortSignal.timeout(FILE_DOWNLOAD_TIMEOUT_MS);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DownloadError("file URL is invalid");
  }

  let response: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (url.protocol !== "https:") throw new DownloadError("file URL must use https");
    const headers = new Headers({ accept: "application/pdf" });
    if (download.token && sameHost(url, download.baseUrl)) {
      headers.set("authorization", `Bearer ${download.token}`);
    }
    try {
      response = await fetchImpl(url.toString(), { method: "GET", headers, redirect: "manual", signal });
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      throw new DownloadError(
        name === "TimeoutError" || name === "AbortError" ? "download timed out" : "download request failed",
      );
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new DownloadError(`download redirect ${response.status} had no location`);
      url = new URL(location, url);
      response = null;
      continue;
    }
    break;
  }
  if (!response) throw new DownloadError("download redirected too many times");

  if (!response.ok) {
    await response.body?.cancel();
    throw new DownloadError(`download failed with status ${response.status}`);
  }

  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!PDF_CONTENT_TYPES.has(contentType)) {
    await response.body?.cancel();
    throw new DownloadError(`file is not a PDF (content type ${contentType || "missing"})`);
  }

  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > FILE_DOWNLOAD_MAX_BYTES) {
    await response.body?.cancel();
    throw new DownloadError("file is larger than 50 MB");
  }

  const bytes = await readCapped(response, FILE_DOWNLOAD_MAX_BYTES);
  if (bytes.byteLength === 0) throw new DownloadError("file is empty");
  if (!PDF_MAGIC.every((byte, index) => bytes[index] === byte)) {
    throw new DownloadError("file is not a PDF");
  }
  return bytes;
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new DownloadError("file is larger than 50 MB");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof DownloadError) throw error;
    const name = error instanceof Error ? error.name : "Error";
    throw new DownloadError(
      name === "TimeoutError" || name === "AbortError" ? "download timed out" : "download stream failed",
    );
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

// ---------------------------------------------------------------- fixtures mode

export const FIXTURES_FILES_HOST = "fixtures.canvas.local";

function findFixtureFilesDirectory(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "fixtures/demo/files"),
    path.resolve(process.cwd(), "packages/canvas/fixtures/demo/files"),
    path.resolve(process.cwd(), "../../packages/canvas/fixtures/demo/files"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * Fixtures-mode download fetch: serves `https://fixtures.canvas.local/files/<name>.pdf`
 * from `packages/canvas/fixtures/demo/files/<name>.pdf` (synthetic PDFs). Anything else is 404.
 */
export function createFixtureFileFetch(directory: string | null = findFixtureFilesDirectory()): typeof fetch {
  return async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const match = /^\/files\/([a-z0-9-]+\.pdf)$/.exec(url.pathname);
    if (!directory || url.hostname !== FIXTURES_FILES_HOST || !match) {
      return new Response("not found", { status: 404 });
    }
    try {
      const bytes = await readFile(/*turbopackIgnore: true*/ path.join(directory, match[1]!));
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: { "content-type": "application/pdf", "content-length": String(bytes.byteLength) },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  };
}
