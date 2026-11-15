// ingestAssignmentFile against the local Supabase stack: the bytes land at the canonical key in
// the private `assignment-files` bucket, pages are 1-based, re-ingest is idempotent, failures end
// in `failed`, a row of another student is never touched, and nothing goes into the notes tables.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import mammoth from "mammoth";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ASSIGNMENT_FILES_BUCKET,
  assignmentFileStoragePath,
  ingestAssignmentFile,
  INTERRUPTED_MESSAGE,
  type AssignmentDocumentType,
} from "../../src/assignment-ingest";
import type { PlutoDb } from "../../src/context";
import { SKIP_DB_TESTS } from "../db-env";
import { createThrowawayUser, deleteUsers, must, serviceClient, type TestUser } from "../db/helpers";
import { makeDocx } from "./assignment-ingest-docx";

const pdfDir = fileURLToPath(new URL("../../../../seed/pdfs/", import.meta.url));
const PDF_FILE = "hist105-week3-scientific-revolution.pdf";
interface Entry {
  file: string;
  pages: { page: number; fact: string }[];
}
const pdfEntry = (JSON.parse(readFileSync(`${pdfDir}manifest.json`, "utf8")) as Entry[]).find((m) => m.file === PDF_FILE)!;
const PDF_BYTES = new Uint8Array(readFileSync(`${pdfDir}${PDF_FILE}`));
const DOCX_BYTES = makeDocx(["BIA Project Description", "List three critical business processes."]);

describe.skipIf(SKIP_DB_TESTS)("ingestAssignmentFile", () => {
  let service: SupabaseClient;
  let admin: PlutoDb;
  let owner: TestUser | undefined;
  let bystander: TestUser | undefined;
  const stored: string[] = [];

  async function newAttachment(studentId: string, fileType: AssignmentDocumentType): Promise<string> {
    const course = must(
      await service.from("courses").insert({ student_id: studentId, name: `Attach ${randomUUID()}` }).select("id").single(),
      "insert course",
    ) as { id: string };
    const assignment = must(
      await service
        .from("assignments")
        .insert({ student_id: studentId, course_id: course.id, title: "BIA Project Milestone" })
        .select("id")
        .single(),
      "insert assignment",
    ) as { id: string };
    const row = must(
      await service
        .from("assignment_files")
        .insert({
          student_id: studentId,
          assignment_id: assignment.id,
          canvas_file_id: String(Math.floor(Math.random() * 1e9)),
          title: `BIA.${fileType}`,
          file_type: fileType,
        })
        .select("id")
        .single(),
      "insert assignment file",
    ) as { id: string };
    stored.push(assignmentFileStoragePath(studentId, row.id, fileType));
    return row.id;
  }

  async function state(id: string) {
    return must(
      await service.from("assignment_files").select("ingest_status, ingest_error, page_count, storage_path").eq("id", id).single(),
      "attachment row",
    ) as { ingest_status: string; ingest_error: string | null; page_count: number | null; storage_path: string | null };
  }

  async function pages(id: string) {
    return must(
      await service
        .from("assignment_file_pages")
        .select("page_number, text, student_id")
        .eq("assignment_file_id", id)
        .order("page_number"),
      "pages",
    ) as { page_number: number; text: string; student_id: string }[];
  }

  beforeAll(async () => {
    service = serviceClient();
    admin = service as unknown as PlutoDb;
    owner = await createThrowawayUser(service, "Attachment Owner");
    bystander = await createThrowawayUser(service, "Attachment Bystander");
  });

  afterAll(async () => {
    if (stored.length) await service.storage.from(ASSIGNMENT_FILES_BUCKET).remove(stored);
    await deleteUsers(service, [owner, bystander]);
  });

  it("stores a PDF, fills 1-based pages, and is idempotent", async () => {
    const id = await newAttachment(owner!.id, "pdf");
    const first = await ingestAssignmentFile(admin, { studentId: owner!.id, assignmentFileId: id, bytes: PDF_BYTES, fileType: "pdf" });
    expect(first).toEqual({ assignmentFileId: id, status: "ready", pageCount: pdfEntry.pages.length });

    const saved = await pages(id);
    expect(saved.map((page) => page.page_number)).toEqual(pdfEntry.pages.map((page) => page.page));
    expect(saved.every((page) => page.student_id === owner!.id)).toBe(true);
    for (const expected of pdfEntry.pages) expect(saved[expected.page - 1]!.text).toContain(expected.fact);
    expect(await state(id)).toEqual({
      ingest_status: "ready",
      ingest_error: null,
      page_count: pdfEntry.pages.length,
      storage_path: `${owner!.id}/${id}.pdf`,
    });

    const object = await service.storage.from(ASSIGNMENT_FILES_BUCKET).download(`${owner!.id}/${id}.pdf`);
    expect(object.error).toBeNull();
    expect(object.data?.type).toBe("application/pdf");
    expect(object.data?.size).toBe(PDF_BYTES.byteLength);

    expect(await ingestAssignmentFile(admin, { studentId: owner!.id, assignmentFileId: id, bytes: PDF_BYTES, fileType: "pdf" })).toEqual(first);
    expect(await pages(id)).toHaveLength(pdfEntry.pages.length);

    // Attachments never become notes.
    const { count } = await service.from("file_pages").select("id", { count: "exact", head: true }).eq("student_id", owner!.id);
    expect(count).toBe(0);
  });

  it("marks the row failed while the text is read, so a crash mid-read never leaves it pending", async () => {
    const id = await newAttachment(owner!.id, "docx");
    const real = mammoth.extractRawText;
    const seen: Array<{ ingest_status: string; ingest_error: string | null }> = [];
    const spy = vi.spyOn(mammoth, "extractRawText").mockImplementation(async (input) => {
      const { ingest_status, ingest_error } = await state(id);
      seen.push({ ingest_status, ingest_error });
      return real(input);
    });
    try {
      const result = await ingestAssignmentFile(admin, { studentId: owner!.id, assignmentFileId: id, bytes: DOCX_BYTES, fileType: "docx" });
      expect(result?.status).toBe("ready");
    } finally {
      spy.mockRestore();
    }
    expect(seen).toEqual([{ ingest_status: "failed", ingest_error: INTERRUPTED_MESSAGE }]);
    expect(await state(id)).toMatchObject({ ingest_status: "ready", ingest_error: null });
  });

  it("stores a Word file with its content type; the owner can read it and the bystander cannot", async () => {
    const id = await newAttachment(owner!.id, "docx");
    const result = await ingestAssignmentFile(admin, { studentId: owner!.id, assignmentFileId: id, bytes: DOCX_BYTES, fileType: "docx" });
    expect(result).toEqual({ assignmentFileId: id, status: "ready", pageCount: 1 });
    expect((await pages(id)).map((page) => page.text)).toEqual([
      "BIA Project Description\n\nList three critical business processes.",
    ]);

    const path = `${owner!.id}/${id}.docx`;
    const mine = await owner!.client.storage.from(ASSIGNMENT_FILES_BUCKET).download(path);
    expect(mine.error).toBeNull();
    expect(mine.data?.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const theirs = await bystander!.client.storage.from(ASSIGNMENT_FILES_BUCKET).download(path);
    expect(theirs.data).toBeNull();
    const ownPages = await owner!.client.from("assignment_file_pages").select("page_number").eq("assignment_file_id", id);
    expect(ownPages.data).toHaveLength(1);
    const foreignPages = await bystander!.client.from("assignment_file_pages").select("page_number").eq("assignment_file_id", id);
    expect(foreignPages.data ?? []).toEqual([]);
  });

  it("ends in failed with ingest_error for unreadable bytes or a type that does not match the row", async () => {
    const id = await newAttachment(owner!.id, "docx");
    const broken = await ingestAssignmentFile(admin, {
      studentId: owner!.id,
      assignmentFileId: id,
      bytes: new TextEncoder().encode("<html>Log in</html>"),
      fileType: "docx",
    });
    expect(broken?.status).toBe("failed");
    expect(broken?.error).toBeTruthy();
    expect(await state(id)).toMatchObject({ ingest_status: "failed", page_count: null, storage_path: null });

    const mismatched = await ingestAssignmentFile(admin, { studentId: owner!.id, assignmentFileId: id, bytes: PDF_BYTES, fileType: "pdf" });
    expect(mismatched).toMatchObject({ status: "failed", error: "file type pdf does not match the saved docx" });
    expect(await pages(id)).toEqual([]);
    const { data: objects } = await service.storage.from(ASSIGNMENT_FILES_BUCKET).list(owner!.id, { search: id });
    expect(objects ?? []).toEqual([]);
  });

  it("returns null for an unknown row or another student's row and writes nothing", async () => {
    expect(
      await ingestAssignmentFile(admin, { studentId: owner!.id, assignmentFileId: randomUUID(), bytes: DOCX_BYTES, fileType: "docx" }),
    ).toBeNull();

    const foreign = await newAttachment(bystander!.id, "docx");
    expect(
      await ingestAssignmentFile(admin, { studentId: owner!.id, assignmentFileId: foreign, bytes: DOCX_BYTES, fileType: "docx" }),
    ).toBeNull();
    expect(await state(foreign)).toMatchObject({ ingest_status: "pending", storage_path: null });
    const { data: objects } = await service.storage.from(ASSIGNMENT_FILES_BUCKET).list(owner!.id, { search: foreign });
    expect(objects ?? []).toEqual([]);
  });
});
