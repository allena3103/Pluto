import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { RECENT_NOTES_TEXT_CAP_CHARS, TOOLS, TOOL_NAMES, type ToolName } from "@pluto/core/contract";
import { handleMcpRequest, type McpHandlerConfig } from "../src/handler";
import { SKIP_DB_TESTS, dbEnv } from "./db-env";
import {
  createCourse,
  createFile,
  createThrowawayUser,
  deleteUsers,
  insertPages,
  must,
  serviceClient,
  uniqueName,
  type TestUser,
} from "./db-helpers";
import { ACCEPT, CHALLENGE, mcpResult, postMcp, rpcBody } from "./request";

const APP_URL = "http://127.0.0.1:3301";
const TOKEN = "pluto-mcp-db-test-token-32chars";
const PAGE_CHARS = 15_000;
const HUGE_PAGE_COUNT = 6;

function configFor(studentId: string): McpHandlerConfig {
  const env = dbEnv();
  return {
    supabaseUrl: env.url,
    supabaseAnonKey: env.anonKey,
    supabaseServiceRoleKey: env.serviceRoleKey,
    appUrl: APP_URL,
    demoToken: TOKEN,
    demoStudentId: studentId,
  };
}

async function callTool(
  studentId: string,
  name: string,
  args: unknown,
): Promise<{ isError?: boolean; text: string; structured?: unknown }> {
  const response = await postMcp(
    configFor(studentId),
    rpcBody("tools/call", { name, arguments: args }),
    `Bearer ${TOKEN}`,
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

function deepLinks(value: unknown, found: string[] = []): string[] {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const item of value) deepLinks(item, found);
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "deepLink" && typeof child === "string") found.push(child);
    else deepLinks(child, found);
  }
  return found;
}

describe.skipIf(SKIP_DB_TESTS)("mcp handler against local supabase", () => {
  let service: SupabaseClient;
  let studentA: TestUser | undefined;
  let studentB: TestUser | undefined;
  let courseAName = "";
  let hugeCourseName = "";
  let fileAId = "";
  let hugeFileId = "";
  let courseBId = "";
  let fileBId = "";
  let assignmentAId = "";
  let assignmentBId = "";
  const secretB = `b-secret-${uniqueName("notes")}`;
  const topicA = `mitochondria-${uniqueName("topic")}`;

  beforeAll(async () => {
    service = serviceClient();
    studentA = await createThrowawayUser(service, "MCP Student A");
    studentB = await createThrowawayUser(service, "MCP Student B");

    const courseA = await createCourse(service, studentA.id, uniqueName("History 105"));
    const hugeCourse = await createCourse(service, studentA.id, uniqueName("Huge Notes"));
    const courseB = await createCourse(service, studentB.id, uniqueName("B Course"));
    courseAName = courseA.name;
    hugeCourseName = hugeCourse.name;
    courseBId = courseB.id;

    fileAId = (
      await createFile(service, {
        studentId: studentA.id,
        courseId: courseA.id,
        title: "Lecture A",
        pageCount: 2,
        addedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      })
    ).id;
    await insertPages(service, studentA.id, fileAId, [
      `Page one mentions ${topicA} in class.`,
      "Page two is a short summary.",
    ]);

    hugeFileId = (
      await createFile(service, {
        studentId: studentA.id,
        courseId: hugeCourse.id,
        title: "Lecture Huge",
        pageCount: HUGE_PAGE_COUNT,
        addedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      })
    ).id;
    await insertPages(
      service,
      studentA.id,
      hugeFileId,
      Array.from({ length: HUGE_PAGE_COUNT }, (_, index) => {
        const page = index + 1;
        const marker = `PAGE-${page}-`;
        return marker + "x".repeat(PAGE_CHARS - marker.length);
      }),
    );
    expect(PAGE_CHARS * 4).toBeLessThanOrEqual(RECENT_NOTES_TEXT_CAP_CHARS);
    expect(PAGE_CHARS * 5).toBeGreaterThan(RECENT_NOTES_TEXT_CAP_CHARS);

    fileBId = (
      await createFile(service, {
        studentId: studentB.id,
        courseId: courseB.id,
        title: "B File",
        pageCount: 1,
      })
    ).id;
    await insertPages(service, studentB.id, fileBId, [secretB]);

    const groupA = must(
      await service
        .from("grade_groups")
        .insert({ student_id: studentA.id, course_id: courseA.id, name: "Essays", weight_percent: 100 })
        .select("id")
        .single(),
      "grade group A",
    ) as { id: string };
    const groupB = must(
      await service
        .from("grade_groups")
        .insert({ student_id: studentB.id, course_id: courseB.id, name: "Secret Group", weight_percent: 100 })
        .select("id")
        .single(),
      "grade group B",
    ) as { id: string };

    const dueAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    assignmentAId = (
      must(
        await service
          .from("assignments")
          .insert({
            student_id: studentA.id,
            course_id: courseA.id,
            grade_group_id: groupA.id,
            title: "Essay A",
            points_possible: 100,
            score: 90,
            graded: true,
            submitted: true,
            due_at: dueAt,
          })
          .select("id")
          .single(),
        "assignment A",
      ) as { id: string }
    ).id;
    assignmentBId = (
      must(
        await service
          .from("assignments")
          .insert({
            student_id: studentB.id,
            course_id: courseB.id,
            grade_group_id: groupB.id,
            title: secretB,
            points_possible: 50,
            score: 10,
            graded: true,
            submitted: true,
            due_at: dueAt,
          })
          .select("id")
          .single(),
        "assignment B",
      ) as { id: string }
    ).id;
  });

  afterAll(async () => {
    if (service) await deleteUsers(service, [studentA, studentB]);
  });

  test("each tool returns contract output and note deep links use appUrl", async () => {
    const studentId = studentA!.id;
    const calls: Record<ToolName, unknown> = {
      list_courses: {},
      get_recent_notes: { course: courseAName },
      get_note_pages: { fileId: fileAId },
      search_notes: { query: topicA },
      get_deadlines: { course: courseAName },
      get_grades: { course: courseAName },
      get_crunch_weeks: {},
      get_assignment: { assignmentId: assignmentAId },
    };

    for (const name of TOOL_NAMES) {
      const result = await callTool(studentId, name, calls[name]);
      expect(result.isError, result.text).toBeFalsy();
      const parsed = TOOLS[name].output.parse(result.structured);
      expect(JSON.parse(result.text)).toEqual(parsed);
      if (name === "get_recent_notes" || name === "get_note_pages" || name === "search_notes") {
        const links = deepLinks(parsed);
        expect(links.length).toBeGreaterThan(0);
        for (const link of links) expect(link.startsWith(APP_URL)).toBe(true);
      }
      if (name === "get_assignment") {
        expect(TOOLS.get_assignment.output.parse(result.structured).url).toBe(`${APP_URL}/assignments/${assignmentAId}`);
      }
    }
  });

  test("student A cannot see student B rows", async () => {
    const studentId = studentA!.id;
    const calls: Array<[string, unknown]> = [
      ["list_courses", {}],
      ["get_recent_notes", { course: courseAName }],
      ["get_recent_notes", { course: hugeCourseName }],
      ["get_note_pages", { fileId: fileAId }],
      ["get_note_pages", { fileId: fileBId }],
      ["search_notes", { query: topicA }],
      ["search_notes", { query: secretB }],
      ["get_deadlines", {}],
      ["get_grades", {}],
      ["get_crunch_weeks", {}],
      ["get_assignment", { assignmentId: assignmentBId }],
    ];
    const blobs: string[] = [];
    for (const [name, args] of calls) {
      const result = await callTool(studentId, name, args);
      blobs.push(result.text, JSON.stringify(result.structured ?? null));
    }
    const blob = blobs.join("\n");
    expect(blob).toContain("assignment_not_found");
    for (const secret of [secretB, courseBId, fileBId, assignmentBId, studentB!.id]) {
      expect(blob).not.toContain(secret);
    }
  });

  test("truncated recent notes resume with get_note_pages", async () => {
    const recent = await callTool(studentA!.id, "get_recent_notes", { course: hugeCourseName, days: 14 });
    expect(recent.isError).toBeFalsy();
    const parsed = TOOLS.get_recent_notes.output.parse(recent.structured);
    expect(parsed.truncated).toBe(true);
    const file = parsed.files.find((item) => item.fileId === hugeFileId);
    expect(file).toBeTruthy();
    expect(file!.pagesIncluded).toBeLessThan(file!.pageCount);
    expect(file!.pagesIncluded).toBeGreaterThan(0);

    const rest = await callTool(studentA!.id, "get_note_pages", {
      fileId: hugeFileId,
      firstPage: file!.pagesIncluded + 1,
    });
    expect(rest.isError).toBeFalsy();
    const pages = TOOLS.get_note_pages.output.parse(rest.structured);
    const expectedStart = file!.pagesIncluded + 1;
    expect(pages.pages.map((page) => page.page)).toEqual(
      Array.from({ length: HUGE_PAGE_COUNT - file!.pagesIncluded }, (_, index) => expectedStart + index),
    );
    expect(pages.pages[0]?.text.startsWith(`PAGE-${expectedStart}-`)).toBe(true);
    expect(pages.pages.at(-1)?.text.startsWith(`PAGE-${HUGE_PAGE_COUNT}-`)).toBe(true);
    for (const link of deepLinks(pages)) expect(link.startsWith(APP_URL)).toBe(true);
  });

  test("unknown course is a tool error", async () => {
    const result = await callTool(studentA!.id, "get_recent_notes", { course: "no-such-course" });
    expect(result.isError).toBe(true);
    expect(result.text.startsWith("course_not_found")).toBe(true);
  });

  test("the url token lists courses for the demo student only", async () => {
    const response = await postMcp(
      { ...configFor(studentA!.id), demoUrlFlag: "1" },
      rpcBody("tools/call", { name: "list_courses", arguments: {} }),
      undefined,
      "http://127.0.0.1:3301/api/mcp",
      { urlToken: TOKEN },
    );
    const { status, body } = await mcpResult(response);
    expect(status, JSON.stringify(body)).toBe(200);
    const result = body.result as { structuredContent?: unknown };
    const parsed = TOOLS.list_courses.output.parse(result.structuredContent);
    expect(parsed.courses.some((course) => course.name === courseAName)).toBe(true);
    const blob = JSON.stringify(parsed);
    expect(blob).not.toContain(courseBId);
    expect(blob).not.toContain(studentB!.id);
    expect(blob).not.toContain(secretB);
  });

  test("an unauthenticated call does not run a tool", async () => {
    const response = await handleMcpRequest(
      new Request("http://127.0.0.1:3301/api/mcp", {
        method: "POST",
        headers: { accept: ACCEPT, "content-type": "application/json" },
        body: rpcBody("tools/call", { name: "list_courses", arguments: {} }),
      }),
      configFor(studentA!.id),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(CHALLENGE);
  });
});
