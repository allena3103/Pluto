// The demo path through the MCP handler against the seeded data (`npm run seed`):
// "build me a study guide from my History 105 notes from the past 2 weeks".
// Expected files, pages and queries come from seed/pdfs/manifest.json.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { GetAssignmentOutput, GetDeadlinesOutput, GetRecentNotesOutput, SearchNotesOutput } from "@pluto/core/contract";
import { DEMO_STUDENT_ID } from "../src/auth";
import type { McpHandlerConfig, McpRequestOptions } from "../src/handler";
import { SKIP_DB_TESTS, dbEnv } from "./db-env";
import { mcpResult, postMcp, rpcBody } from "./request";

const APP_URL = "https://pluto.example.test";
const TOKEN = "pluto-mcp-seeded-test-token-32ch";
// supabase/seed.sql: the second seeded student.
const OTHER_STUDENT_ID = "22222222-2222-4222-8222-222222222222";
// supabase/seed.sql: Biology 151 "Lab Report 3: Mitosis" with a read Word handout and a listed-only spreadsheet.
const LAB_REPORT_ID = "a0000000-0000-4000-8000-000000000112";
const HANDOUT_ID = "af000000-0000-4000-8000-000000000001";

type ManifestEntry = {
  file: string;
  courseKey: string;
  title: string;
  weekLabel: string;
  addedDaysAgo: number;
  pages: { page: number; fact: string; query: string }[];
};

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../seed/pdfs/manifest.json", import.meta.url)), "utf8"),
) as ManifestEntry[];

/** Same derivation as `seedFileId` in scripts/lib/seed-files.ts. */
function seedFileId(studentId: string, file: string): string {
  const hex = createHash("sha256").update(`${studentId}:${file}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function config(studentId: string, overrides: Partial<McpHandlerConfig> = {}): McpHandlerConfig {
  const env = dbEnv();
  return {
    supabaseUrl: env.url,
    supabaseAnonKey: env.anonKey,
    supabaseServiceRoleKey: env.serviceRoleKey,
    appUrl: APP_URL,
    demoToken: TOKEN,
    demoStudentId: studentId,
    ...overrides,
  };
}

type ToolResult = { isError?: boolean; text: string; structured?: unknown };

async function callTool(
  cfg: McpHandlerConfig,
  name: string,
  args: unknown,
  options?: McpRequestOptions,
): Promise<ToolResult> {
  const response = await postMcp(
    cfg,
    rpcBody("tools/call", { name, arguments: args }),
    options ? undefined : `Bearer ${TOKEN}`,
    "http://127.0.0.1:3300/api/mcp",
    options,
  );
  const { status, body } = await mcpResult(response);
  expect(status, JSON.stringify(body)).toBe(200);
  const result = body.result as {
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
  };
  const text = result.content?.find((block) => block.type === "text")?.text ?? "";
  return { isError: result.isError, text, structured: result.structuredContent };
}

const recentHistory = manifest.filter((entry) => entry.courseKey === "history105" && entry.addedDaysAgo < 14);

describe.skipIf(SKIP_DB_TESTS)("mcp handler on the seeded demo student", () => {
  test("the manifest has recent History 105 lectures to build a study guide from", () => {
    expect(recentHistory.length).toBeGreaterThanOrEqual(3);
  });

  test("get_recent_notes for History 105 returns the last two weeks of lectures with page deep links", async () => {
    const result = await callTool(config(DEMO_STUDENT_ID), "get_recent_notes", { course: "History 105" });
    expect(result.isError, result.text).toBeFalsy();
    const output = GetRecentNotesOutput.parse(result.structured);

    expect(output.course.name).toBe("History 105");
    expect(output.truncated).toBe(false);
    expect(output.files.map((file) => file.title).sort()).toEqual(recentHistory.map((entry) => entry.title).sort());

    for (const entry of recentHistory) {
      const fileId = seedFileId(DEMO_STUDENT_ID, entry.file);
      const file = output.files.find((candidate) => candidate.fileId === fileId);
      expect(file, entry.file).toBeDefined();
      if (!file) continue;
      expect(file.weekLabel).toBe(entry.weekLabel);
      expect(file.pageCount).toBe(entry.pages.length);
      expect(file.pagesIncluded).toBe(entry.pages.length);
      for (const expected of entry.pages) {
        const page = file.pages.find((candidate) => candidate.page === expected.page);
        expect(page, `${entry.file} page ${expected.page}`).toBeDefined();
        // Each page carries its distinctive fact and a link to exactly that page (1-based).
        expect(page?.text).toContain(expected.fact);
        expect(page?.deepLink).toBe(`${APP_URL}/notes/${fileId}?page=${expected.page}`);
      }
    }
  });

  test("search_notes finds a manifest fact on the right file and page", async () => {
    const entry = recentHistory[0];
    const target = entry?.pages[1] ?? entry?.pages[0];
    expect(entry && target).toBeTruthy();
    if (!entry || !target) return;
    const fileId = seedFileId(DEMO_STUDENT_ID, entry.file);

    const result = await callTool(config(DEMO_STUDENT_ID), "search_notes", {
      query: target.query,
      course: "History 105",
      limit: 3,
    });
    expect(result.isError, result.text).toBeFalsy();
    const top = SearchNotesOutput.parse(result.structured).results[0];
    expect(top?.fileId).toBe(fileId);
    expect(top?.page).toBe(target.page);
    expect(top?.deepLink).toBe(`${APP_URL}/notes/${fileId}?page=${target.page}`);
  });

  test("get_note_pages returns one seeded page by number", async () => {
    const entry = recentHistory[0];
    if (!entry) return;
    const fileId = seedFileId(DEMO_STUDENT_ID, entry.file);
    const last = entry.pages[entry.pages.length - 1];
    if (!last) return;
    const result = await callTool(config(DEMO_STUDENT_ID), "get_note_pages", {
      fileId,
      firstPage: last.page,
      lastPage: last.page,
    });
    expect(result.isError, result.text).toBeFalsy();
    const output = result.structured as { pages: { page: number; text: string }[] };
    expect(output.pages.map((page) => page.page)).toEqual([last.page]);
    expect(output.pages[0]?.text).toContain(last.fact);
  });

  test("the URL-token route serves the same notes when the flag is on", async () => {
    const result = await callTool(
      config(DEMO_STUDENT_ID, { demoUrlFlag: "1" }),
      "get_recent_notes",
      { course: "History 105" },
      { urlToken: TOKEN },
    );
    expect(result.isError, result.text).toBeFalsy();
    const output = GetRecentNotesOutput.parse(result.structured);
    expect(output.files.length).toBe(recentHistory.length);
  });

  test("the other seeded student sees none of the demo student's notes", async () => {
    const other = config(OTHER_STUDENT_ID);
    const demoFileIds = manifest.map((entry) => seedFileId(DEMO_STUDENT_ID, entry.file));

    const recent = await callTool(other, "get_recent_notes", { course: "History 105" });
    expect(recent.isError).toBe(true);
    expect(recent.text.startsWith("course_not_found")).toBe(true);

    const query = recentHistory[0]?.pages[0]?.query ?? "Gutenberg";
    const search = await callTool(other, "search_notes", { query });
    expect(search.isError, search.text).toBeFalsy();
    const results = SearchNotesOutput.parse(search.structured).results;
    for (const hit of results) expect(demoFileIds).not.toContain(hit.fileId);

    const pages = await callTool(other, "get_note_pages", { fileId: demoFileIds[0] });
    expect(pages.isError).toBe(true);
    expect(pages.text.startsWith("file_not_found")).toBe(true);
    for (const fileId of demoFileIds) {
      expect(recent.text).not.toContain(fileId);
      expect(search.text).not.toContain(fileId);
    }
  });

  test("tools/list offers get_assignment and it returns the seeded lab report with its handout text", async () => {
    const listed = await mcpResult(
      await postMcp(config(DEMO_STUDENT_ID), rpcBody("tools/list", {}), `Bearer ${TOKEN}`, "http://127.0.0.1:3300/api/mcp"),
    );
    const tools = (listed.body.result?.tools ?? []) as Array<{ name: string; annotations?: { readOnlyHint?: boolean } }>;
    expect(tools.find((tool) => tool.name === "get_assignment")?.annotations?.readOnlyHint).toBe(true);

    const deadlines = await callTool(config(DEMO_STUDENT_ID), "get_deadlines", { course: "Biology 151" });
    expect(deadlines.isError, deadlines.text).toBeFalsy();
    const lab = GetDeadlinesOutput.parse(deadlines.structured).deadlines.find((d) => d.assignmentId === LAB_REPORT_ID);
    expect(lab?.attachmentCount).toBe(2);

    const result = await callTool(config(DEMO_STUDENT_ID), "get_assignment", { assignmentId: LAB_REPORT_ID });
    expect(result.isError, result.text).toBeFalsy();
    const output = GetAssignmentOutput.parse(result.structured);
    expect(output).toMatchObject({
      title: "Lab Report 3: Mitosis",
      courseName: "Biology 151",
      url: `${APP_URL}/assignments/${LAB_REPORT_ID}`,
      truncated: false,
    });
    expect(output.instructions).toContain("onion root tip");
    expect(output.attachments.map((a) => [a.title, a.fileType, a.status, a.pages.length])).toEqual([
      ["Lab_3_Mitosis_Handout.docx", "docx", "ready", 1],
      ["Mitosis_Data_Template.xlsx", "other", "skipped", 0],
    ]);
    expect(output.attachments[0]?.url).toBe(`${APP_URL}/assignments/${LAB_REPORT_ID}/files/${HANDOUT_ID}`);
    expect(output.attachments[0]?.pages[0]?.text).toContain("mitotic index table");

    const other = await callTool(config(OTHER_STUDENT_ID), "get_assignment", { assignmentId: LAB_REPORT_ID });
    expect(other.isError).toBe(true);
    expect(other.text.startsWith("assignment_not_found")).toBe(true);
    expect(other.text).not.toContain("mitotic");
  });
});
