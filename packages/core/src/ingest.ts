/**
 * PDF ingest: one `file_pages` row per PDF page (1-based), so search and citations can
 * point at an exact page. Server-only: `ingestFile` needs a service-role client.
 */
import { extractText, getDocumentProxy } from "unpdf";
import type { PlutoDb } from "./context";
import type { IngestStatus } from "./contract";

export const NOTES_BUCKET = "notes";
export const INGEST_MAX_BYTES = 50 * 1024 * 1024;
export const INGEST_MAX_PAGES = 2000;
export const INGEST_DOWNLOAD_TIMEOUT_MS = 30_000;
const INSERT_BATCH = 200;

export interface IngestResult {
  fileId: string;
  status: IngestStatus;
  pageCount?: number;
  error?: string;
}

/** The only storage key a file may live at. Never read a key from the row itself. */
export function notesStoragePath(studentId: string, fileId: string): string {
  return `${studentId}/${fileId}.pdf`;
}

/**
 * Text of every page, in order: index 0 is page 1. Whitespace is collapsed; a page
 * with no selectable text gives an empty string.
 */
export async function extractPdfPages(bytes: Uint8Array): Promise<string[]> {
  if (bytes.byteLength === 0) throw new Error("PDF is empty");
  if (bytes.byteLength > INGEST_MAX_BYTES) throw new Error("PDF is larger than 50 MB");
  // unpdf detaches the buffer it is given, so hand it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  if (pdf.numPages > INGEST_MAX_PAGES) throw new Error(`PDF has more than ${INGEST_MAX_PAGES} pages`);
  const { text } = await extractText(pdf, { mergePages: false });
  return text.map((page) => page.replace(/\s+/g, " ").trim());
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
 * Ingests one stored PDF. Returns null when the file does not exist.
 * Never leaves a file in `processing`: any failure ends in `failed` with `ingest_error` set.
 * Idempotent: ingesting twice leaves the same rows.
 */
export async function ingestFile(admin: PlutoDb, fileId: string): Promise<IngestResult | null> {
  const { data: file, error: fileError } = await admin
    .from("files")
    .select("id, student_id, storage_path")
    .eq("id", fileId)
    .maybeSingle();
  if (fileError) throw new Error(`ingest: loading file failed: ${fileError.message}`);
  if (!file) return null;

  const studentId = file.student_id;
  const fail = async (err: unknown): Promise<IngestResult> => {
    const message = shortMessage(err);
    await admin
      .from("files")
      .update({ ingest_status: "failed", ingest_error: message })
      .eq("id", fileId)
      .eq("student_id", studentId);
    return { fileId, status: "failed", error: message };
  };

  try {
    // The path is derived from the row's owner and id. The stored value is only checked,
    // never used, so a row can never make the server read another student's object.
    const path = notesStoragePath(studentId, fileId);
    if (file.storage_path !== null && file.storage_path !== path) {
      return await fail(new Error("stored storage_path does not match <student_id>/<file_id>.pdf"));
    }

    const { error: startError } = await admin
      .from("files")
      .update({ ingest_status: "processing", ingest_error: null })
      .eq("id", fileId)
      .eq("student_id", studentId);
    if (startError) throw new Error(`could not mark file as processing: ${startError.message}`);

    const download = await withTimeout(
      admin.storage.from(NOTES_BUCKET).download(path),
      INGEST_DOWNLOAD_TIMEOUT_MS,
      "storage download",
    );
    if (download.error || !download.data) {
      throw new Error(`could not download the PDF from storage: ${download.error?.message ?? "no data"}`);
    }
    if (download.data.size > INGEST_MAX_BYTES) throw new Error("PDF is larger than 50 MB");

    const pages = await extractPdfPages(new Uint8Array(await download.data.arrayBuffer()));

    const { error: deleteError } = await admin
      .from("file_pages")
      .delete()
      .eq("file_id", fileId)
      .eq("student_id", studentId);
    if (deleteError) throw new Error(`could not clear old pages: ${deleteError.message}`);

    const rows = pages.map((text, index) => ({
      student_id: studentId,
      file_id: fileId,
      page_number: index + 1, // 1-based
      text,
    }));
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const { error: insertError } = await admin.from("file_pages").insert(rows.slice(i, i + INSERT_BATCH));
      if (insertError) throw new Error(`could not save page text: ${insertError.message}`);
    }

    const { error: doneError } = await admin
      .from("files")
      .update({ ingest_status: "ready", ingest_error: null, page_count: pages.length, storage_path: path })
      .eq("id", fileId)
      .eq("student_id", studentId);
    if (doneError) throw new Error(`could not mark file as ready: ${doneError.message}`);

    return { fileId, status: "ready", pageCount: pages.length };
  } catch (err) {
    return fail(err);
  }
}
