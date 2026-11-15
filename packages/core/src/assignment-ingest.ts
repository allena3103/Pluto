/**
 * Assignment attachment ingest: stores a downloaded PDF or Word file in the private
 * `assignment-files` bucket and its text in `assignment_file_pages` (one row per page,
 * 1-based). Kept apart from notes (`files` / `file_pages`) on purpose.
 * Server-only: `ingestAssignmentFile` needs a service-role client.
 */
import { inflateRawSync } from "node:zlib";
import mammoth from "mammoth";
import type { PlutoDb } from "./context";
import { extractPdfPages, INGEST_MAX_BYTES, INGEST_MAX_PAGES } from "./ingest";

export const ASSIGNMENT_FILES_BUCKET = "assignment-files";
/** A Word file has no pages: its text is cut into pages of about this many characters at paragraph ends. */
export const DOCX_PAGE_CHARS = 3000;
const UPLOAD_TIMEOUT_MS = 30_000;
const INSERT_BATCH = 200;
/** A Word file may unpack to at most this much in total (declared and real). */
export const DOCX_MAX_UNPACKED_BYTES = 25 * 1024 * 1024;
/** Most a zip entry over `RATIO_CHECK_FLOOR` may expand; real Word parts stay far below it. */
const DOCX_MAX_RATIO = 200;
const RATIO_CHECK_FLOOR = 1024 * 1024;
/** Written before the text is read, so a crash while reading leaves a `failed` row, not a `pending` one. */
export const INTERRUPTED_MESSAGE = "Interrupted while reading";

export type AssignmentDocumentType = "pdf" | "docx";

export const ASSIGNMENT_FILE_CONTENT_TYPES: Record<AssignmentDocumentType, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export interface AssignmentIngestResult {
  assignmentFileId: string;
  status: "ready" | "failed";
  pageCount?: number;
  error?: string;
}

/** The only storage key an attachment may live at (same rule as the table's check constraint). */
export function assignmentFileStoragePath(
  studentId: string,
  assignmentFileId: string,
  fileType: AssignmentDocumentType,
): string {
  return `${studentId}/${assignmentFileId}.${fileType}`;
}

/**
 * Text of every page, in order: index 0 is page 1. PDF pages come from unpdf (whitespace
 * collapsed, a page without selectable text is ""). A Word file's paragraphs (blank line
 * between them) are packed into pages of up to `DOCX_PAGE_CHARS`; a file without text has no pages.
 */
export async function extractDocumentPages(bytes: Uint8Array, fileType: AssignmentDocumentType): Promise<string[]> {
  if (fileType === "pdf") return extractPdfPages(bytes);
  if (bytes.byteLength === 0) throw new Error("Word file is empty");
  if (bytes.byteLength > INGEST_MAX_BYTES) throw new Error("Word file is larger than 50 MB");
  checkDocxZip(bytes);
  const { value } = await mammoth.extractRawText({
    buffer: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  });
  const pages = packPages(paragraphsOf(value), DOCX_PAGE_CHARS);
  if (pages.length > INGEST_MAX_PAGES) throw new Error(`Word file has more than ${INGEST_MAX_PAGES} pages of text`);
  return pages;
}

/**
 * Refuses a Word file that would unpack to too much before mammoth (which unpacks every part
 * into memory) sees it. Reads the zip's central directory the way JSZip does, checks the
 * declared sizes, then unpacks every entry with a hard output limit so a lying header is caught.
 * Only stored and deflate entries are accepted; ZIP64, encryption and prepended data are not.
 */
export function checkDocxZip(bytes: Uint8Array): void {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const damaged = () => new Error("Word file is damaged");
  const unsupported = () => new Error("Word file uses a zip feature that is not supported");
  const tooBig = () => new Error(`Word file unpacks to more than ${DOCX_MAX_UNPACKED_BYTES / 1024 / 1024} MB`);
  const tooCompressed = () => new Error("Word file is compressed too much to be read safely");

  let end = -1;
  for (let at = data.length - 22; at >= Math.max(0, data.length - 22 - 0xffff); at -= 1) {
    if (data.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw damaged();
  const entryCount = data.readUInt16LE(end + 10);
  const directorySize = data.readUInt32LE(end + 12);
  const directoryOffset = data.readUInt32LE(end + 16);
  if (entryCount === 0xffff || directoryOffset === 0xffffffff) throw unsupported();
  // No bytes before the zip or between the entries and the directory: JSZip would shift its offsets.
  if (directoryOffset + directorySize !== end) throw damaged();

  const entries: Array<{ method: number; compressed: number; size: number; local: number }> = [];
  let declared = 0;
  for (let at = directoryOffset, index = 0; index < entryCount; index += 1) {
    if (at + 46 > end || data.readUInt32LE(at) !== 0x02014b50) throw damaged();
    const flags = data.readUInt16LE(at + 8);
    const method = data.readUInt16LE(at + 10);
    const compressed = data.readUInt32LE(at + 20);
    const size = data.readUInt32LE(at + 24);
    if ((flags & 0x1) !== 0 || (method !== 0 && method !== 8)) throw unsupported();
    if (compressed === 0xffffffff || size === 0xffffffff) throw unsupported();
    declared += size;
    if (declared > DOCX_MAX_UNPACKED_BYTES) throw tooBig();
    if (size > RATIO_CHECK_FLOOR && size > compressed * DOCX_MAX_RATIO) throw tooCompressed();
    entries.push({ method, compressed, size, local: data.readUInt32LE(at + 42) });
    at += 46 + data.readUInt16LE(at + 28) + data.readUInt16LE(at + 30) + data.readUInt16LE(at + 32);
  }

  let unpacked = 0;
  for (const entry of entries) {
    if (entry.local + 30 > directoryOffset || data.readUInt32LE(entry.local) !== 0x04034b50) throw damaged();
    const start = entry.local + 30 + data.readUInt16LE(entry.local + 26) + data.readUInt16LE(entry.local + 28);
    if (start + entry.compressed > directoryOffset) throw damaged();
    let length = entry.compressed;
    if (entry.method === 8 && entry.compressed > 0) {
      try {
        length = inflateRawSync(data.subarray(start, start + entry.compressed), {
          maxOutputLength: Math.max(1, DOCX_MAX_UNPACKED_BYTES - unpacked),
        }).byteLength;
      } catch (error) {
        // Node reports output past `maxOutputLength` as a RangeError (ERR_BUFFER_TOO_LARGE).
        if (error instanceof RangeError) throw tooBig();
        throw damaged();
      }
    }
    unpacked += length;
    if (unpacked > DOCX_MAX_UNPACKED_BYTES) throw tooBig();
    if (length > RATIO_CHECK_FLOOR && length > entry.compressed * DOCX_MAX_RATIO) throw tooCompressed();
  }
}

/** Paragraphs (mammoth ends each with a blank line), spaces collapsed, line breaks inside kept, empties dropped. */
function paragraphsOf(raw: string): string[] {
  return raw
    .replaceAll("\u0000", "")
    .split(/\n[ \t]*\n/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n"),
    )
    .filter(Boolean);
}

function packPages(paragraphs: string[], limit: number): string[] {
  const pages: string[] = [];
  let page = "";
  for (const paragraph of paragraphs) {
    let rest = paragraph;
    // A paragraph longer than a page is cut at the last space before the limit.
    while (rest) {
      let piece = rest;
      if (rest.length > limit) {
        const space = rest.lastIndexOf(" ", limit);
        let cut = space > limit / 2 ? space : limit;
        const code = rest.charCodeAt(cut - 1);
        if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
        piece = rest.slice(0, cut).trimEnd();
      }
      rest = rest.slice(piece.length).trimStart();
      if (page && page.length + 2 + piece.length > limit) {
        pages.push(page);
        page = "";
      }
      page = page ? `${page}\n\n${piece}` : piece;
    }
  }
  if (page) pages.push(page);
  return pages;
}

function withTimeout<T>(promise: PromiseLike<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

function shortMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : "ingest failed";
  return message.split("\n")[0]!.slice(0, 300);
}

/**
 * Reads the text out of `bytes`, uploads them to `<student_id>/<assignment_file_id>.<type>`,
 * replaces the row's pages and marks it `ready` with `page_count`. Returns null when the
 * student has no such row. Any failure ends in `failed` with `ingest_error` set (no URLs);
 * if even that write fails, it throws. Idempotent: ingesting twice leaves the same rows.
 */
export async function ingestAssignmentFile(
  admin: PlutoDb,
  input: { studentId: string; assignmentFileId: string; bytes: Uint8Array; fileType: AssignmentDocumentType },
): Promise<AssignmentIngestResult | null> {
  const { studentId, assignmentFileId, bytes, fileType } = input;
  if (!studentId) throw new TypeError("studentId is required");
  const { data: row, error: rowError } = await admin
    .from("assignment_files")
    .select("id, file_type")
    .eq("id", assignmentFileId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (rowError) throw new Error(`assignment ingest: loading the file failed: ${rowError.message}`);
  if (!row) return null;

  try {
    if (row.file_type !== fileType) throw new Error(`file type ${fileType} does not match the saved ${row.file_type}`);
    // If the process dies while reading, the row says so and the sync tries never-read rows first.
    const { error: startError } = await admin
      .from("assignment_files")
      .update({ ingest_status: "failed", ingest_error: INTERRUPTED_MESSAGE, updated_at: new Date().toISOString() })
      .eq("id", assignmentFileId)
      .eq("student_id", studentId);
    if (startError) throw new Error(`could not record the attempt: ${startError.message}`);
    const pages = await extractDocumentPages(bytes, fileType);

    const path = assignmentFileStoragePath(studentId, assignmentFileId, fileType);
    const upload = await withTimeout(
      admin.storage
        .from(ASSIGNMENT_FILES_BUCKET)
        .upload(path, bytes, { contentType: ASSIGNMENT_FILE_CONTENT_TYPES[fileType], upsert: true }),
      UPLOAD_TIMEOUT_MS,
      "storage upload",
    );
    if (upload.error) throw new Error(`could not store the file: ${upload.error.message}`);

    const { error: deleteError } = await admin
      .from("assignment_file_pages")
      .delete()
      .eq("assignment_file_id", assignmentFileId)
      .eq("student_id", studentId);
    if (deleteError) throw new Error(`could not clear old pages: ${deleteError.message}`);

    const rows = pages.map((text, index) => ({
      student_id: studentId,
      assignment_file_id: assignmentFileId,
      page_number: index + 1, // 1-based
      text,
    }));
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const { error: insertError } = await admin.from("assignment_file_pages").insert(rows.slice(i, i + INSERT_BATCH));
      if (insertError) throw new Error(`could not save page text: ${insertError.message}`);
    }

    const { error: doneError } = await admin
      .from("assignment_files")
      .update({
        ingest_status: "ready",
        ingest_error: null,
        page_count: pages.length,
        storage_path: path,
        updated_at: new Date().toISOString(),
      })
      .eq("id", assignmentFileId)
      .eq("student_id", studentId);
    if (doneError) throw new Error(`could not mark the file as ready: ${doneError.message}`);

    return { assignmentFileId, status: "ready", pageCount: pages.length };
  } catch (err) {
    const message = shortMessage(err);
    const { error: failError } = await admin
      .from("assignment_files")
      .update({ ingest_status: "failed", ingest_error: message, updated_at: new Date().toISOString() })
      .eq("id", assignmentFileId)
      .eq("student_id", studentId);
    if (failError) {
      throw new Error(`assignment ingest: could not record the failure (${message}): ${failError.message}`, {
        cause: err,
      });
    }
    return { assignmentFileId, status: "failed", error: message };
  }
}
