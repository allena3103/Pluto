import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@pluto/core/database.types";
import type { PlutoDb } from "@pluto/core/context";
import { NOTES_BUCKET } from "@pluto/core/ingest";
import { createCanvasClient, type CanvasClient } from "../../src/client";
import { createFixtureFileFetch, syncCanvasFiles, type FilesSyncResult } from "../../src/files-sync";
import { syncCanvas } from "../../src/sync";
import type { CanvasCourseFile } from "../../src/types";
import { dbEnv, SKIP_DB_TESTS } from "../db-env";

const TOKEN = "canvas-files-test-token-DO-NOT-LEAK";
const LIVE_BASE = "https://school.instructure.com";
const FILES_DIR = fileURLToPath(new URL("../../fixtures/demo/files", import.meta.url));

function service(): PlutoDb {
  const env = dbEnv();
  return createClient<Database>(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) }),
    },
  });
}

function fixturesClient(extraHistFiles: CanvasCourseFile[] = [], bump?: { id: string; updatedAt: string }): CanvasClient {
  const base = createCanvasClient({ baseUrl: "https://fixtures.canvas.local", token: TOKEN, mode: "fixtures" });
  return {
    ...base,
    listCourseFiles: async (courseId) => {
      const rows = await base.listCourseFiles(courseId);
      const all = courseId === "seed-hist-105" ? [...rows, ...extraHistFiles] : rows;
      return all.map((row) => (bump && row.canvasFileId === bump.id ? { ...row, updatedAt: bump.updatedAt } : row));
    },
  };
}

type Call = { url: string; authorization: string | null };

/** Fake download: serves the synthetic PDFs and records every request's auth header. */
function recordingFileFetch(override?: (url: URL) => Response | null): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const files = createFixtureFileFetch(FILES_DIR);
  const impl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url: url.toString(), authorization: new Headers(init?.headers).get("authorization") });
    return override?.(url) ?? files(input, init);
  };
  return { fetch: impl, calls };
}

async function createUser(db: PlutoDb): Promise<string> {
  const email = `canvas-files-${randomBytes(8).toString("hex")}@pluto.test`;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: `pw-${randomBytes(12).toString("hex")}`,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? "createUser failed");
  return data.user.id;
}

async function cleanup(db: PlutoDb, studentId: string): Promise<void> {
  const { data } = await db.storage.from(NOTES_BUCKET).list(studentId, { limit: 1000 });
  const paths = (data ?? []).map((object) => `${studentId}/${object.name}`);
  if (paths.length > 0) await db.storage.from(NOTES_BUCKET).remove(paths);
  const { error } = await db.auth.admin.deleteUser(studentId);
  if (error) console.warn(`cleanup: could not delete ${studentId}: ${error.message}`);
}

type FileState = { id: string; canvas_file_id: string | null; ingest_status: string; ingest_error: string | null; page_count: number | null };

async function fileStates(db: PlutoDb, studentId: string): Promise<Map<string, FileState>> {
  const { data, error } = await db
    .from("files")
    .select("id, canvas_file_id, ingest_status, ingest_error, page_count")
    .eq("student_id", studentId);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row) => [row.canvas_file_id ?? row.id, row]));
}

async function pageNumbers(db: PlutoDb, studentId: string): Promise<Map<string, number[]>> {
  const { data, error } = await db
    .from("file_pages")
    .select("file_id, page_number")
    .eq("student_id", studentId)
    .order("page_number");
  if (error) throw new Error(error.message);
  const out = new Map<string, number[]>();
  for (const row of data ?? []) out.set(row.file_id, [...(out.get(row.file_id) ?? []), row.page_number]);
  return out;
}

async function objectCount(db: PlutoDb, studentId: string): Promise<number> {
  const { data } = await db.storage.from(NOTES_BUCKET).list(studentId, { limit: 1000 });
  return (data ?? []).length;
}

function log(label: string, result: FilesSyncResult, extra: Record<string, unknown> = {}): void {
  console.log(`FILES_SYNC ${label} ${JSON.stringify({ ...result, ...extra })}`);
}

const HIDDEN_FILES_BASE = "https://canvas.local";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * Live-mode Canvas API for one course whose Files tab is hidden: `/files` is 403 and the
 * PDFs are only reachable through Modules (7 and 8 are PDFs, 9 is a spreadsheet, 10 is locked).
 */
function hiddenFilesTabFetch(requested: string[]): typeof fetch {
  const pdf = (id: number, name: string) => ({
    id,
    display_name: `${name}.pdf`,
    filename: `${name}.pdf`,
    "content-type": "application/pdf",
    url: `${HIDDEN_FILES_BASE}/files/${id}/download?download_frd=1&verifier=v${id}`,
    updated_at: "2026-11-01T00:00:00Z",
    created_at: "2026-10-01T00:00:00Z",
    size: 4096,
  });
  return async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    requested.push(url.pathname);
    switch (url.pathname) {
      case "/api/v1/courses":
        return json([{ id: 42, name: "COMPSCI 999", term: { name: "Fall 2026" } }]);
      case "/api/v1/courses/42/assignment_groups":
      case "/api/v1/courses/42/assignments":
        return json([]);
      case "/api/v1/courses/42/files":
        return json({ status: "unauthorized", errors: [{ message: "user not authorized to perform that action" }] }, 403);
      case "/api/v1/courses/42/modules":
        return json([
          {
            name: "Week 3",
            items: [
              { type: "File", content_id: 7 },
              { type: "Page", content_id: 1 },
              { type: "File", content_id: 8 },
              { type: "File", content_id: 9 },
              { type: "File", content_id: 10 },
            ],
          },
        ]);
      case "/api/v1/courses/42/files/7":
        return json(pdf(7, "hist-week-7"));
      case "/api/v1/courses/42/files/8":
        return json(pdf(8, "bio-lab-3"));
      case "/api/v1/courses/42/files/9":
        return json({ id: 9, display_name: "grades.xlsx", "content-type": "application/vnd.ms-excel" });
      default:
        return json({ errors: [{ message: "The specified resource does not exist." }] }, 404);
    }
  };
}

describe.skipIf(SKIP_DB_TESTS)("syncCanvasFiles", () => {
  let db: PlutoDb | undefined;
  const created: string[] = [];
  const database = () => (db ??= service());

  afterAll(async () => {
    if (!db) return;
    for (const id of created) await cleanup(db, id);
  });

  it("downloads, stores and ingests; a second run downloads nothing; another student is untouched", async () => {
    const admin = database();
    const student = await createUser(admin);
    const other = await createUser(admin);
    created.push(student, other);

    for (const id of [student, other]) {
      const sync = await syncCanvas({ db: admin, studentId: id, client: fixturesClient() });
      expect(sync.errors).toEqual([]);
    }
    const otherBefore = await fileStates(admin, other);

    // Token + a live base URL, but the fixture file URLs are on another host: no auth header.
    const first = recordingFileFetch();
    const download = { baseUrl: LIVE_BASE, token: TOKEN, fetch: first.fetch };
    const result1 = await syncCanvasFiles({ admin, studentId: student, client: fixturesClient(), download });
    const pagesAfter1 = await pageNumbers(admin, student);
    const pageRows1 = [...pagesAfter1.values()].reduce((sum, pages) => sum + pages.length, 0);
    log("first", result1, { filePagesRows: pageRows1 });

    expect(result1).toMatchObject({ downloaded: 3, ingested: 3, failed: 0, skipped: 0, errors: [] });
    expect(first.calls).toHaveLength(3);
    expect(first.calls.every((call) => call.authorization === null)).toBe(true);

    const states = await fileStates(admin, student);
    expect(states.size).toBe(3);
    for (const state of states.values()) {
      expect(state.ingest_status).toBe("ready");
      const pages = pagesAfter1.get(state.id) ?? [];
      expect(pages.length).toBe(state.page_count);
      expect(pages).toEqual(Array.from({ length: pages.length }, (_, index) => index + 1));
      expect(pages.length).toBeGreaterThan(0);
    }

    const second = recordingFileFetch();
    const result2 = await syncCanvasFiles({
      admin,
      studentId: student,
      client: fixturesClient(),
      download: { ...download, fetch: second.fetch },
    });
    const pageRows2 = [...(await pageNumbers(admin, student)).values()].reduce((sum, pages) => sum + pages.length, 0);
    log("second", result2, { filePagesRows: pageRows2 });
    expect(result2).toMatchObject({ downloaded: 0, ingested: 0, skipped: 3, failed: 0 });
    expect(second.calls).toHaveLength(0);
    expect(pageRows2).toBe(pageRows1);

    // A file edited in Canvas after our upload is fetched again (only that one).
    const third = recordingFileFetch();
    const result3 = await syncCanvasFiles({
      admin,
      studentId: student,
      client: fixturesClient([], { id: "hist-file-1", updatedAt: new Date(Date.now() + 60_000).toISOString() }),
      download: { ...download, fetch: third.fetch },
    });
    log("canvas-updated", result3);
    expect(result3).toMatchObject({ downloaded: 1, ingested: 1, skipped: 2, failed: 0 });

    // The other student: same rows, still pending, no objects, no pages.
    const otherAfter = await fileStates(admin, other);
    expect(otherAfter).toEqual(otherBefore);
    expect([...otherAfter.values()].every((state) => state.ingest_status === "pending")).toBe(true);
    expect(await objectCount(admin, other)).toBe(0);
    expect((await pageNumbers(admin, other)).size).toBe(0);
  });

  it("marks only the broken files failed (404, over the cap, not a PDF) and leaves nothing processing", async () => {
    const admin = database();
    const student = await createUser(admin);
    created.push(student);

    const broken = (id: string, name: string): CanvasCourseFile => ({
      canvasFileId: id,
      title: `${name}.pdf`,
      url: `https://fixtures.canvas.local/broken/${name}.pdf`,
      updatedAt: "2026-11-10T00:00:00Z",
      createdAt: "2026-11-01T00:00:00Z",
      sizeBytes: 1000,
    });
    const extra = [broken("broken-404", "missing"), broken("broken-big", "huge"), broken("broken-html", "page")];
    const client = fixturesClient(extra);
    expect((await syncCanvas({ db: admin, studentId: student, client })).errors).toEqual([]);

    const { fetch } = recordingFileFetch((url) => {
      if (url.pathname === "/broken/missing.pdf") return new Response("gone", { status: 404 });
      if (url.pathname === "/broken/huge.pdf") {
        return new Response("%PDF-", {
          status: 200,
          headers: { "content-type": "application/pdf", "content-length": String(60 * 1024 * 1024) },
        });
      }
      if (url.pathname === "/broken/page.pdf") {
        return new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } });
      }
      return null;
    });

    const result = await syncCanvasFiles({
      admin,
      studentId: student,
      client,
      download: { baseUrl: "https://fixtures.canvas.local", fetch },
    });
    log("failures", result);
    expect(result).toMatchObject({ downloaded: 3, ingested: 3, failed: 3 });

    const states = await fileStates(admin, student);
    console.log(
      `FILES_SYNC failure-states ${JSON.stringify(
        [...states.entries()].map(([key, state]) => ({ key, status: state.ingest_status, error: state.ingest_error })),
      )}`,
    );
    expect(states.get("broken-404")).toMatchObject({ ingest_status: "failed", ingest_error: "download failed with status 404" });
    expect(states.get("broken-big")).toMatchObject({ ingest_status: "failed", ingest_error: "file is larger than 50 MB" });
    expect(states.get("broken-html")).toMatchObject({
      ingest_status: "failed",
      ingest_error: "file is not a PDF (content type text/html)",
    });
    for (const id of ["hist-file-1", "bio-file-1", "stat-file-1"]) {
      expect(states.get(id)?.ingest_status).toBe("ready");
    }
    expect([...states.values()].some((state) => state.ingest_status === "processing")).toBe(false);
    // Failed rows are retried on the next sync (they are not `ready`).
    const retry = await syncCanvasFiles({
      admin,
      studentId: student,
      client,
      download: { baseUrl: "https://fixtures.canvas.local", fetch },
    });
    expect(retry).toMatchObject({ downloaded: 0, ingested: 0, failed: 3, skipped: 3 });
  });

  it("downloads and ingests PDFs read from Modules when the Files tab is hidden (403)", async () => {
    const admin = database();
    const student = await createUser(admin);
    created.push(student);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const requested: string[] = [];
    const client = createCanvasClient({
      baseUrl: HIDDEN_FILES_BASE,
      token: TOKEN,
      mode: "live",
      fetch: hiddenFilesTabFetch(requested),
      sleep: async () => {},
    });

    const sync = await syncCanvas({ db: admin, studentId: student, client });
    expect(sync.errors).toEqual([]);
    expect(sync.files).toEqual({ inserted: 2, updated: 0 });
    expect(requested).toContain("/api/v1/courses/42/files");

    // Canvas download URLs redirect to a file host; the token must stay on the Canvas host.
    const download = recordingFileFetch((url) => {
      const match = /^\/files\/(\d+)\/download$/.exec(url.pathname);
      if (url.hostname !== "canvas.local" || !match) return null;
      const name = match[1] === "7" ? "hist-week-7" : match[1] === "8" ? "bio-lab-3" : null;
      if (!name) return new Response("gone", { status: 404 });
      return new Response(null, { status: 302, headers: { location: `https://fixtures.canvas.local/files/${name}.pdf` } });
    });
    const result = await syncCanvasFiles({
      admin,
      studentId: student,
      client,
      download: { baseUrl: HIDDEN_FILES_BASE, token: TOKEN, fetch: download.fetch },
    });
    log("hidden-files-tab", result);
    warn.mockRestore();

    expect(result).toMatchObject({ downloaded: 2, ingested: 2, failed: 0, skipped: 0, errors: [] });
    expect(download.calls.map((call) => [new URL(call.url).host, call.authorization !== null])).toEqual([
      ["canvas.local", true],
      ["fixtures.canvas.local", false],
      ["canvas.local", true],
      ["fixtures.canvas.local", false],
    ]);

    const states = await fileStates(admin, student);
    expect([...states.keys()].sort()).toEqual(["7", "8"]);
    const pages = await pageNumbers(admin, student);
    for (const state of states.values()) {
      expect(state.ingest_status).toBe("ready");
      expect(state.page_count).toBeGreaterThan(0);
      expect(pages.get(state.id)).toHaveLength(state.page_count!);
    }
    expect(await objectCount(admin, student)).toBe(2);

    const { data: labels, error } = await admin.from("files").select("week_label").eq("student_id", student);
    expect(error).toBeNull();
    expect((labels ?? []).map((row) => row.week_label)).toEqual(["Week 3", "Week 3"]);
  });
});
