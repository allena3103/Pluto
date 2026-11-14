// ingestFile against the local Supabase stack: pages are 1-based, search finds them,
// re-ingest is idempotent, failures end in `failed`, and the storage path is never trusted.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlutoDb } from "../../src/context";
import { ingestFile, NOTES_BUCKET, notesStoragePath } from "../../src/ingest";
import { SKIP_DB_TESTS } from "../db-env";
import { createThrowawayUser, deleteUsers, must, serviceClient, type TestUser } from "../db/helpers";

const pdfDir = fileURLToPath(new URL("../../../../seed/pdfs/", import.meta.url));
const FILE = "hist105-week3-scientific-revolution.pdf";
interface Entry {
  file: string;
  pages: { page: number; fact: string; query: string }[];
}
const entry = (JSON.parse(readFileSync(`${pdfDir}manifest.json`, "utf8")) as Entry[]).find((m) => m.file === FILE)!;

describe.skipIf(SKIP_DB_TESTS)("ingestFile", () => {
  let service: SupabaseClient;
  let admin: PlutoDb;
  let owner: TestUser | undefined;
  let bystander: TestUser | undefined;
  let courseId: string;
  const uploaded: string[] = [];

  async function newCourse(studentId: string): Promise<string> {
    const row = must(
      await service.from("courses").insert({ student_id: studentId, name: `Ingest ${randomUUID()}` }).select("id").single(),
      "insert course",
    ) as { id: string };
    return row.id;
  }

  async function newFile(studentId: string, course: string, withStoragePath = true): Promise<string> {
    const id = randomUUID();
    must(
      await service
        .from("files")
        .insert({
          id,
          student_id: studentId,
          course_id: course,
          title: "Ingest test file",
          source: "manual",
          storage_path: withStoragePath ? notesStoragePath(studentId, id) : null,
        })
        .select("id")
        .single(),
      "insert file",
    );
    return id;
  }

  async function upload(studentId: string, fileId: string): Promise<void> {
    const path = notesStoragePath(studentId, fileId);
    const { error } = await service.storage
      .from(NOTES_BUCKET)
      .upload(path, readFileSync(`${pdfDir}${FILE}`), { contentType: "application/pdf", upsert: true });
    if (error) throw new Error(`upload failed: ${error.message}`);
    uploaded.push(path);
  }

  async function pageCount(fileId: string): Promise<number | null> {
    const { count } = await service.from("file_pages").select("id", { count: "exact", head: true }).eq("file_id", fileId);
    return count;
  }

  beforeAll(async () => {
    service = serviceClient();
    admin = service as unknown as PlutoDb;
    owner = await createThrowawayUser(service, "Ingest Owner");
    bystander = await createThrowawayUser(service, "Ingest Bystander");
    courseId = await newCourse(owner.id);
  });

  afterAll(async () => {
    if (uploaded.length) await service.storage.from(NOTES_BUCKET).remove(uploaded);
    await deleteUsers(service, [owner, bystander]);
  });

  it("fills file_pages with 1-based pages, is searchable and idempotent", async () => {
    const fileId = await newFile(owner!.id, courseId);
    await upload(owner!.id, fileId);

    const first = await ingestFile(admin, fileId);
    expect(first).toEqual({ fileId, status: "ready", pageCount: entry.pages.length });

    const pages = must(
      await service.from("file_pages").select("page_number, text, student_id").eq("file_id", fileId).order("page_number"),
      "pages",
    ) as { page_number: number; text: string; student_id: string }[];
    expect(pages.map((p) => p.page_number)).toEqual(entry.pages.map((p) => p.page));
    expect(pages[0]!.page_number).toBe(1);
    expect(pages.every((p) => p.student_id === owner!.id)).toBe(true);
    for (const expected of entry.pages) expect(pages[expected.page - 1]!.text).toContain(expected.fact);

    const target = entry.pages[2]!;
    const hits = must(
      await service.rpc("search_notes", { p_student_id: owner!.id, p_query: target.query, p_limit: 5 }),
      "search",
    ) as { file_id: string; page_number: number }[];
    expect(hits[0]).toMatchObject({ file_id: fileId, page_number: target.page });
    const foreign = must(
      await service.rpc("search_notes", { p_student_id: bystander!.id, p_query: target.query, p_limit: 5 }),
      "search as bystander",
    ) as unknown[];
    expect(foreign).toEqual([]);

    const second = await ingestFile(admin, fileId);
    expect(second).toEqual(first);
    expect(await pageCount(fileId)).toBe(entry.pages.length);

    const row = must(
      await service.from("files").select("ingest_status, ingest_error, page_count, storage_path").eq("id", fileId).single(),
      "file row",
    );
    expect(row).toEqual({
      ingest_status: "ready",
      ingest_error: null,
      page_count: entry.pages.length,
      storage_path: notesStoragePath(owner!.id, fileId),
    });
  });

  it("ends in failed with ingest_error when the storage object is missing", async () => {
    const fileId = await newFile(owner!.id, courseId);
    const result = await ingestFile(admin, fileId);
    expect(result?.status).toBe("failed");
    expect(result?.error).toBeTruthy();
    const row = must(
      await service.from("files").select("ingest_status, ingest_error").eq("id", fileId).single(),
      "file row",
    ) as { ingest_status: string; ingest_error: string | null };
    expect(row.ingest_status).toBe("failed");
    expect(row.ingest_error).toBeTruthy();
    expect(await pageCount(fileId)).toBe(0);
  });

  it("returns null for an unknown file", async () => {
    expect(await ingestFile(admin, randomUUID())).toBeNull();
  });

  it("never reads another student's object: the path comes from the row's owner and id", async () => {
    // The bystander has a real PDF in storage. The owner's row has no object of its own.
    const bystanderFile = await newFile(bystander!.id, await newCourse(bystander!.id));
    await upload(bystander!.id, bystanderFile);

    // The database refuses a row that points into someone else's folder...
    const ownerFile = await newFile(owner!.id, courseId, false);
    const aimed = await service
      .from("files")
      .update({ storage_path: notesStoragePath(bystander!.id, bystanderFile) })
      .eq("id", ownerFile);
    expect(aimed.error).not.toBeNull();

    // ...and ingest only ever looks at <owner>/<ownerFile>.pdf, which does not exist.
    const result = await ingestFile(admin, ownerFile);
    expect(result?.status).toBe("failed");
    expect(await pageCount(ownerFile)).toBe(0);
  });
});
