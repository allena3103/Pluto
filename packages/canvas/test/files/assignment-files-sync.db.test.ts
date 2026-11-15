import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@pluto/core/database.types";
import type { PlutoDb } from "@pluto/core/context";
import { ASSIGNMENT_FILES_BUCKET, ingestAssignmentFile, READ_LIMITS, READ_TOO_BIG_MESSAGE, readDocument } from "@pluto/core/assignment-ingest";
import { NOTES_BUCKET } from "@pluto/core/ingest";
import { syncAssignmentFiles, type AssignmentFilesSyncResult } from "../../src/assignment-files-sync";
import { createCanvasClient, type CanvasClient } from "../../src/client";
import { createFixtureFileFetch } from "../../src/files-sync";
import { syncCanvas } from "../../src/sync";
import { makeDocx } from "../../../core/test/ingest/assignment-ingest-docx";
import { dbEnv, SKIP_DB_TESTS } from "../db-env";

const TOKEN = "canvas-attachments-test-token-DO-NOT-LEAK";
const VERIFIER = "SIGNED-VERIFIER-DO-NOT-STORE";
const CANVAS = "https://canvas.local";
const FILES_DIR = fileURLToPath(new URL("../../fixtures/demo/files", import.meta.url));
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function service(): PlutoDb {
  const env = dbEnv();
  return createClient<Database>(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) }),
    },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fileLink(id: number, name: string): string {
  return `<a class="instructure_file_link instructure_scribd_file inline_disabled" title="${name}" href="${CANVAS}/courses/77/files/${id}?wrap=1" target="_blank" data-api-endpoint="${CANVAS}/api/v1/courses/77/files/${id}" data-api-returntype="File">${name}</a>`;
}

/** `docxUpdatedAt`: the Word file's Canvas `updated_at` (default 2026-11-01). */
type CanvasState = { linksDocx: boolean; docxUpdatedAt?: string };

/**
 * Live-mode Canvas for one course whose Files tab is hidden (403). One assignment links a PDF
 * (11), a Word file (12) and a spreadsheet (13) from its description, plus an image preview (14).
 */
function canvasApi(state: CanvasState): typeof fetch {
  const meta = (id: number, name: string, contentType: string) => ({
    id,
    display_name: name,
    filename: name,
    "content-type": contentType,
    size: 2048,
    updated_at: "2026-11-01T00:00:00Z",
    url: `${CANVAS}/files/${id}/download?download_frd=1&verifier=${VERIFIER}`,
  });
  return async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    switch (url.pathname) {
      case "/api/v1/courses":
        return json([{ id: 77, name: "OIM 999", term: { name: "Fall 2026" } }]);
      case "/api/v1/courses/77/assignment_groups":
      case "/api/v1/courses/77/modules":
        return json([]);
      case "/api/v1/courses/77/assignments":
        return json([
          {
            id: 501,
            name: "BIA Project Milestone",
            due_at: "2026-12-01T04:59:00Z",
            points_possible: 100,
            html_url: `${CANVAS}/courses/77/assignments/501`,
            description: [
              "<h3>Project milestone</h3>",
              "<p>Complete the business impact analysis &amp; submit it by Friday.</p>",
              `<p>Read ${fileLink(11, "BIA_Project_Description.pdf")}${state.linksDocx ? ` and fill in ${fileLink(12, "BIA_Template.docx")}` : ""}.</p>`,
              `<p>Data: ${fileLink(13, "Systems.xlsx")}</p>`,
              `<p><img src="${CANVAS}/courses/77/files/14/preview" data-api-endpoint="${CANVAS}/api/v1/courses/77/files/14"></p>`,
            ].join("\n"),
          },
          { id: 502, name: "Quiz 3", due_at: null, points_possible: 10, description: null, html_url: null },
        ]);
      case "/api/v1/courses/77/files":
        return json({ status: "unauthorized", errors: [{ message: "user not authorized to perform that action" }] }, 403);
      case "/api/v1/courses/77/files/11":
        return json(meta(11, "BIA_Project_Description.pdf", "application/pdf"));
      case "/api/v1/courses/77/files/12":
        return json({ ...meta(12, "BIA_Template.docx", DOCX), updated_at: state.docxUpdatedAt ?? "2026-11-01T00:00:00Z" });
      case "/api/v1/courses/77/files/13":
        return json(meta(13, "Systems.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
      default:
        return json({ errors: [{ message: "The specified resource does not exist." }] }, 404);
    }
  };
}

function liveClient(state: CanvasState): CanvasClient {
  return createCanvasClient({ baseUrl: CANVAS, token: TOKEN, mode: "live", fetch: canvasApi(state), sleep: async () => {} });
}

type Call = { url: URL; authorization: string | null };

/** Canvas download URLs redirect to a file host that serves the synthetic fixture files. */
function downloads(override?: (url: URL) => Response | null): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const files = createFixtureFileFetch(FILES_DIR);
  const target: Record<string, string> = { "11": "stat-proposal-guidelines.pdf", "12": "stat-proposal-template.docx" };
  const impl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url, authorization: new Headers(init?.headers).get("authorization") });
    const overridden = override?.(url);
    if (overridden) return overridden;
    const id = /^\/files\/(\d+)\/download$/.exec(url.pathname)?.[1];
    if (url.hostname === "canvas.local" && id && Object.hasOwn(target, id)) {
      return new Response(null, { status: 302, headers: { location: `https://fixtures.canvas.local/files/${target[id]}` } });
    }
    return files(input, init);
  };
  return { fetch: impl, calls };
}

async function createUser(db: PlutoDb): Promise<string> {
  const { data, error } = await db.auth.admin.createUser({
    email: `canvas-attachments-${randomBytes(8).toString("hex")}@pluto.test`,
    password: `pw-${randomBytes(12).toString("hex")}`,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? "createUser failed");
  return data.user.id;
}

async function objectNames(db: PlutoDb, bucket: string, studentId: string): Promise<string[]> {
  const { data, error } = await db.storage.from(bucket).list(studentId, { limit: 1000 });
  if (error) throw new Error(error.message);
  return (data ?? []).map((object) => object.name).sort();
}

async function cleanup(db: PlutoDb, studentId: string): Promise<void> {
  for (const bucket of [ASSIGNMENT_FILES_BUCKET, NOTES_BUCKET]) {
    const names = await objectNames(db, bucket, studentId);
    if (names.length > 0) await db.storage.from(bucket).remove(names.map((name) => `${studentId}/${name}`));
  }
  const { error } = await db.auth.admin.deleteUser(studentId);
  if (error) console.warn(`cleanup: could not delete ${studentId}: ${error.message}`);
}

async function attachmentRows(db: PlutoDb, studentId: string) {
  const { data, error } = await db
    .from("assignment_files")
    .select("*")
    .eq("student_id", studentId)
    .order("canvas_file_id");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function pagesOf(db: PlutoDb, studentId: string, assignmentFileId: string) {
  const { data, error } = await db
    .from("assignment_file_pages")
    .select("page_number, text")
    .eq("student_id", studentId)
    .eq("assignment_file_id", assignmentFileId)
    .order("page_number");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function rowCount(db: PlutoDb, table: "files" | "file_pages", studentId: string): Promise<number> {
  const { count, error } = await db.from(table).select("id", { count: "exact", head: true }).eq("student_id", studentId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function log(label: string, result: AssignmentFilesSyncResult): void {
  console.log(`ASSIGNMENT_FILES_SYNC ${label} ${JSON.stringify(result)}`);
}

describe.skipIf(SKIP_DB_TESTS)("assignment attachments sync", () => {
  let db: PlutoDb | undefined;
  const created: string[] = [];
  const database = () => (db ??= service());

  afterAll(async () => {
    if (!db) return;
    for (const id of created) await cleanup(db, id);
  });

  it("stores the instructions, reads the PDF and Word file, lists the spreadsheet, and follows link removals", async () => {
    const admin = database();
    const student = await createUser(admin);
    created.push(student);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state: CanvasState = { linksDocx: true };

    const sync = await syncCanvas({ db: admin, studentId: student, client: liveClient(state) });
    expect(sync.errors).toEqual([]);
    expect(sync.assignments).toEqual({ inserted: 2, updated: 0 });
    expect(sync.assignmentFiles).toEqual({ inserted: 3, updated: 0, removed: 0 });

    const { data: assignment, error: assignmentError } = await admin
      .from("assignments")
      .select("description, canvas_url")
      .eq("student_id", student)
      .eq("canvas_assignment_id", "501")
      .single();
    if (assignmentError) throw new Error(assignmentError.message);
    expect(assignment).toEqual({
      description: [
        "Project milestone",
        "",
        "Complete the business impact analysis & submit it by Friday.",
        "",
        "Read BIA_Project_Description.pdf and fill in BIA_Template.docx.",
        "",
        "Data: Systems.xlsx",
      ].join("\n"),
      canvas_url: `${CANVAS}/courses/77/assignments/501`,
    });

    const first = downloads();
    const result1 = await syncAssignmentFiles({
      admin,
      studentId: student,
      client: liveClient(state),
      download: { baseUrl: CANVAS, token: TOKEN, fetch: first.fetch },
    });
    log("first", result1);
    expect(result1).toEqual({ downloaded: 2, ingested: 2, skipped: 0, failed: 0, errors: [] });

    // The token goes to the Canvas host only, never to the file host it redirects to; the
    // spreadsheet is never downloaded.
    expect(first.calls).toHaveLength(4);
    for (const call of first.calls) {
      expect(call.authorization).toBe(call.url.hostname === "canvas.local" ? `Bearer ${TOKEN}` : null);
    }
    expect(first.calls.filter((call) => call.url.hostname === "fixtures.canvas.local")).toHaveLength(2);
    expect(first.calls.some((call) => call.url.pathname === "/files/13/download")).toBe(false);

    const rows = await attachmentRows(admin, student);
    expect(rows.map((row) => [row.canvas_file_id, row.title, row.file_type, row.ingest_status])).toEqual([
      ["11", "BIA_Project_Description.pdf", "pdf", "ready"],
      ["12", "BIA_Template.docx", "docx", "ready"],
      ["13", "Systems.xlsx", "other", "skipped"],
    ]);
    const [pdf, docx, sheet] = rows;
    expect(pdf).toMatchObject({ page_count: 2, ingest_error: null, storage_path: `${student}/${pdf!.id}.pdf` });
    expect(docx).toMatchObject({ page_count: 1, ingest_error: null, storage_path: `${student}/${docx!.id}.docx` });
    expect(sheet).toMatchObject({ page_count: null, storage_path: null });

    const pdfPages = await pagesOf(admin, student, pdf!.id);
    expect(pdfPages.map((page) => page.page_number)).toEqual([1, 2]);
    expect(pdfPages[0]!.text).toContain("Project Proposal Guidelines");
    expect(pdfPages[1]!.text).toContain("scatterplot");
    const docxPages = await pagesOf(admin, student, docx!.id);
    expect(docxPages).toEqual([
      {
        page_number: 1,
        text: [
          "Statistics 240 - Project Proposal Template (Canvas)",
          "1. Research question: state one question your dataset can answer.",
          "2. Data source: name the dataset and say how many rows it has.",
          "3. Planned method: say which regression you will run and why it fits the question.",
        ].join("\n\n"),
      },
    ]);

    expect(await objectNames(admin, ASSIGNMENT_FILES_BUCKET, student)).toEqual([`${pdf!.id}.pdf`, `${docx!.id}.docx`].sort());
    // Attachments are not notes.
    expect(await rowCount(admin, "files", student)).toBe(0);
    expect(await rowCount(admin, "file_pages", student)).toBe(0);
    expect(await objectNames(admin, NOTES_BUCKET, student)).toEqual([]);
    // The download link is a capability URL: never stored or reported.
    const { data: storedAssignments } = await admin.from("assignments").select("*").eq("student_id", student);
    for (const value of [rows, storedAssignments, sync, result1]) {
      expect(JSON.stringify(value)).not.toContain(VERIFIER);
      expect(JSON.stringify(value)).not.toContain(TOKEN);
    }

    // Second run: the rows keep their status and nothing is downloaded again.
    const sync2 = await syncCanvas({ db: admin, studentId: student, client: liveClient(state) });
    expect(sync2.assignmentFiles).toEqual({ inserted: 0, updated: 3, removed: 0 });
    const second = downloads();
    const result2 = await syncAssignmentFiles({
      admin,
      studentId: student,
      client: liveClient(state),
      download: { baseUrl: CANVAS, token: TOKEN, fetch: second.fetch },
    });
    log("second", result2);
    expect(result2).toEqual({ downloaded: 0, ingested: 0, skipped: 2, failed: 0, errors: [] });
    expect(second.calls).toEqual([]);
    expect((await attachmentRows(admin, student)).map((row) => row.ingest_status)).toEqual(["ready", "ready", "skipped"]);

    // The teacher removes the Word link: its row, pages and stored object go.
    state.linksDocx = false;
    const sync3 = await syncCanvas({ db: admin, studentId: student, client: liveClient(state) });
    expect(sync3.errors).toEqual([]);
    expect(sync3.assignmentFiles).toEqual({ inserted: 0, updated: 2, removed: 1 });
    expect((await attachmentRows(admin, student)).map((row) => row.canvas_file_id)).toEqual(["11", "13"]);
    expect(await pagesOf(admin, student, docx!.id)).toEqual([]);
    expect(await objectNames(admin, ASSIGNMENT_FILES_BUCKET, student)).toEqual([`${pdf!.id}.pdf`]);
    warn.mockRestore();
  });

  it("marks a download that is not a Word file failed without the URL, and retries it next sync", async () => {
    const admin = database();
    const student = await createUser(admin);
    created.push(student);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state: CanvasState = { linksDocx: true };
    expect((await syncCanvas({ db: admin, studentId: student, client: liveClient(state) })).errors).toEqual([]);

    const loginPage = downloads((url) =>
      url.pathname === "/files/12/download"
        ? new Response("<html>Log in to Canvas</html>", { status: 200, headers: { "content-type": "text/html" } })
        : null,
    );
    const result = await syncAssignmentFiles({
      admin,
      studentId: student,
      client: liveClient(state),
      download: { baseUrl: CANVAS, token: TOKEN, fetch: loginPage.fetch },
    });
    log("failure", result);
    expect(result).toMatchObject({ downloaded: 1, ingested: 1, failed: 1 });
    expect(result.errors).toEqual(["attachment 12: file is not a Word document (content type text/html)"]);

    const rows = await attachmentRows(admin, student);
    expect(rows.map((row) => [row.canvas_file_id, row.ingest_status, row.ingest_error])).toEqual([
      ["11", "ready", null],
      ["12", "failed", "file is not a Word document (content type text/html)"],
      ["13", "skipped", null],
    ]);
    expect(JSON.stringify(rows)).not.toContain(VERIFIER);

    // Never-read rows go before failed ones: with room for one download, the pending PDF wins.
    const reset = await admin
      .from("assignment_files")
      .update({ ingest_status: "pending" })
      .eq("student_id", student)
      .eq("canvas_file_id", "11");
    if (reset.error) throw new Error(reset.error.message);
    const one = downloads();
    const capped = await syncAssignmentFiles(
      { admin, studentId: student, client: liveClient(state), download: { baseUrl: CANVAS, token: TOKEN, fetch: one.fetch } },
      { maxFiles: 1 },
    );
    expect(capped).toEqual({ downloaded: 1, ingested: 1, skipped: 1, failed: 0, errors: [] });
    expect((await attachmentRows(admin, student)).map((row) => row.ingest_status)).toEqual(["ready", "failed", "skipped"]);

    const retry = downloads();
    const again = await syncAssignmentFiles({
      admin,
      studentId: student,
      client: liveClient(state),
      download: { baseUrl: CANVAS, token: TOKEN, fetch: retry.fetch },
    });
    log("retry", again);
    expect(again).toEqual({ downloaded: 1, ingested: 1, skipped: 1, failed: 0, errors: [] });
    expect((await attachmentRows(admin, student)).map((row) => row.ingest_status)).toEqual(["ready", "ready", "skipped"]);
    warn.mockRestore();
  });

  it("a Word file too complex to read fails in its worker, is tried twice, then waits for a newer Canvas version", async () => {
    const admin = database();
    const student = await createUser(admin);
    created.push(student);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state: CanvasState = { linksDocx: true };
    expect((await syncCanvas({ db: admin, studentId: student, client: liveClient(state) })).errors).toEqual([]);

    // ~3 MB of tiny paragraphs: passes every byte check; its parse runs out of a small worker heap.
    const bomb = makeDocx(Array.from({ length: 60_000 }, () => "a"));
    const tinyHeap = { ...READ_LIMITS, maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4 };
    const ingest: typeof ingestAssignmentFile = (db, input) =>
      ingestAssignmentFile(db, input, { read: (bytes, fileType) => readDocument(bytes, fileType, tinyHeap) });
    const bombDownloads = () =>
      downloads((url) =>
        url.pathname === "/files/12/download"
          ? new Response(bomb.slice(), { status: 200, headers: { "content-type": DOCX } })
          : null,
      );
    const run = (fetch: typeof globalThis.fetch) =>
      syncAssignmentFiles({ admin, studentId: student, client: liveClient(state), download: { baseUrl: CANVAS, token: TOKEN, fetch }, ingest });
    const docxRow = async () => (await attachmentRows(admin, student)).find((row) => row.canvas_file_id === "12")!;

    const first = await run(bombDownloads().fetch);
    log("bomb-1", first);
    expect(first).toMatchObject({ downloaded: 2, ingested: 1, failed: 1, errors: [`attachment 12: ingest failed: ${READ_TOO_BIG_MESSAGE}`] });
    expect(await docxRow()).toMatchObject({ ingest_status: "failed", ingest_error: READ_TOO_BIG_MESSAGE, ingest_attempts: 1 });

    const second = await run(bombDownloads().fetch);
    log("bomb-2", second);
    expect(second).toMatchObject({ downloaded: 1, failed: 1 });
    expect(await docxRow()).toMatchObject({ ingest_status: "failed", ingest_attempts: 2 });

    // Two tries used up: the next sync doesn't even download it.
    const third = bombDownloads();
    const skipped = await run(third.fetch);
    log("bomb-3", skipped);
    expect(skipped).toEqual({ downloaded: 0, ingested: 0, skipped: 2, failed: 0, errors: [] });
    expect(third.calls).toEqual([]);

    // The teacher uploads a fixed version: the metadata sync resets the row and it is read again.
    state.docxUpdatedAt = "2026-11-10T00:00:00Z";
    expect((await syncCanvas({ db: admin, studentId: student, client: liveClient(state) })).errors).toEqual([]);
    expect(await docxRow()).toMatchObject({ ingest_status: "pending", ingest_attempts: 0 });
    const fixed = await run(downloads().fetch);
    log("bomb-fixed", fixed);
    expect(fixed).toEqual({ downloaded: 1, ingested: 1, skipped: 1, failed: 0, errors: [] });
    expect(await docxRow()).toMatchObject({ ingest_status: "ready", ingest_error: null, ingest_attempts: 0, page_count: 1 });
    warn.mockRestore();
  });

  it("caps linked-file lookups per assignment and per course, and stops them at the time budget", async () => {
    const admin = database();
    const student = await createUser(admin);
    created.push(student);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // 11 assignments x 25 links = 275 ids; 20 kept per assignment = 220; 200 looked up per course.
    const looked: string[] = [];
    const api: typeof fetch = async (input) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === "/api/v1/courses") return json([{ id: 88, name: "OIM 888", term: null }]);
      if (url.pathname === "/api/v1/courses/88/assignments") {
        return json(
          Array.from({ length: 11 }, (_, a) => ({
            id: 900 + a,
            name: `Case ${a}`,
            description: Array.from({ length: 25 }, (_, i) => `<a href="/courses/88/files/${a * 100 + i}">f</a>`).join(" "),
          })),
        );
      }
      const file = /^\/api\/v1\/courses\/88\/files\/(\d+)$/.exec(url.pathname)?.[1];
      if (file) {
        looked.push(file);
        return json({ id: Number(file), display_name: `data-${file}.xlsx`, "content-type": "application/vnd.ms-excel", size: 1 });
      }
      return json([]);
    };
    const client = createCanvasClient({ baseUrl: CANVAS, token: TOKEN, mode: "live", fetch: api, sleep: async () => {} });

    const sync = await syncCanvas({ db: admin, studentId: student, client });
    expect(looked).toHaveLength(200);
    expect(sync.assignmentFiles).toEqual({ inserted: 200, updated: 0, removed: 0 });
    expect(sync.errors).toEqual([
      "attachments 88: 75 linked files skipped (at most 20 per assignment and 200 per course)",
    ]);
    expect(await attachmentRows(admin, student)).toHaveLength(200);

    // The time budget runs out after the first batch of lookups: no more start, and the
    // rows that were not read this time stay as they are.
    looked.length = 0;
    const realNow = Date.now.bind(Date);
    let offset = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
    const slowClient: CanvasClient = {
      ...client,
      getCourseFile: async (courseId, fileId) => {
        const found = await client.getCourseFile(courseId, fileId);
        offset = 10 * 60 * 1000;
        return found;
      },
    };
    try {
      const late = await syncCanvas({ db: admin, studentId: student, client: slowClient });
      expect(looked).toHaveLength(4);
      expect(late.errors).toContain("attachments 88: stopped at the sync time budget; the rest are read next sync");
      expect(late.assignmentFiles).toEqual({ inserted: 0, updated: 4, removed: 0 });
    } finally {
      clock.mockRestore();
    }
    expect(await attachmentRows(admin, student)).toHaveLength(200);
    warn.mockRestore();
  });
});
