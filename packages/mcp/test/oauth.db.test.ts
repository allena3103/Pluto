import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { TOOLS, TOOL_NAMES, type ToolName } from "@pluto/core/contract";
import { authenticate } from "../src/auth";
import type { McpHandlerConfig } from "../src/handler";
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
import { CHALLENGE, INVALID_CHALLENGE, mcpResult, postMcp, rpcBody } from "./request";

const APP_URL = "http://127.0.0.1:3301";
const DEMO_STUDENT = "44444444-4444-4444-8444-444444444444";

/** OAuth path only: no demo token unless a test adds one. */
function config(overrides: Partial<McpHandlerConfig> = {}): McpHandlerConfig {
  const env = dbEnv();
  return {
    supabaseUrl: env.url,
    supabaseAnonKey: env.anonKey,
    supabaseServiceRoleKey: env.serviceRoleKey,
    appUrl: APP_URL,
    demoStudentId: DEMO_STUDENT,
    ...overrides,
  };
}

async function accessToken(user: TestUser): Promise<string> {
  const { data, error } = await user.client.auth.getSession();
  if (error || !data.session) throw new Error(`no session for ${user.email}`);
  return data.session.access_token;
}

async function callTool(
  token: string,
  name: string,
  args: unknown,
): Promise<{ isError?: boolean; text: string; structured?: unknown }> {
  const response = await postMcp(config(), rpcBody("tools/call", { name, arguments: args }), `Bearer ${token}`);
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

/** Replace one character in the signature segment. */
function tamperSignature(token: string): string {
  const dot = token.lastIndexOf(".");
  const index = dot + 5;
  const replacement = token[index] === "A" ? "B" : "A";
  return token.slice(0, index) + replacement + token.slice(index + 1);
}

describe.skipIf(SKIP_DB_TESTS)("mcp oauth bearer against local supabase", () => {
  let service: SupabaseClient;
  let studentA: TestUser | undefined;
  let studentB: TestUser | undefined;
  let tokenA = "";
  let tokenB = "";
  let courseAId = "";
  let courseAName = "";
  let fileAId = "";
  const secretA = `a-secret-${uniqueName("notes")}`;

  beforeAll(async () => {
    service = serviceClient();
    studentA = await createThrowawayUser(service, "OAuth Student A");
    studentB = await createThrowawayUser(service, "OAuth Student B");
    tokenA = await accessToken(studentA);
    tokenB = await accessToken(studentB);

    const courseA = await createCourse(service, studentA.id, uniqueName("History 105"));
    courseAId = courseA.id;
    courseAName = courseA.name;
    await createCourse(service, studentB.id, uniqueName("B Course"));

    fileAId = (
      await createFile(service, {
        studentId: studentA.id,
        courseId: courseA.id,
        title: "OAuth Lecture A",
        pageCount: 1,
        addedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      })
    ).id;
    await insertPages(service, studentA.id, fileAId, [`Page one covers ${secretA}.`]);

    const group = must(
      await service
        .from("grade_groups")
        .insert({ student_id: studentA.id, course_id: courseA.id, name: "Essays", weight_percent: 100 })
        .select("id")
        .single(),
      "grade group A",
    ) as { id: string };
    must(
      await service
        .from("assignments")
        .insert({
          student_id: studentA.id,
          course_id: courseA.id,
          grade_group_id: group.id,
          title: `Essay ${secretA}`,
          points_possible: 100,
          score: 90,
          graded: true,
          submitted: true,
          due_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .select("id")
        .single(),
      "assignment A",
    );
  });

  afterAll(async () => {
    if (service) await deleteUsers(service, [studentA, studentB]);
  });

  test("student A's token lists only A's courses and every tool is contract-valid", async () => {
    const listed = await callTool(tokenA, "list_courses", {});
    expect(listed.isError, listed.text).toBeFalsy();
    const courses = TOOLS.list_courses.output.parse(listed.structured).courses;
    expect(courses.map((course) => course.courseId)).toEqual([courseAId]);

    const calls: Record<ToolName, unknown> = {
      list_courses: {},
      get_recent_notes: { course: courseAName },
      get_note_pages: { fileId: fileAId },
      search_notes: { query: secretA },
      get_deadlines: { course: courseAName },
      get_grades: { course: courseAName },
      get_crunch_weeks: {},
    };
    for (const name of TOOL_NAMES) {
      const result = await callTool(tokenA, name, calls[name]);
      expect(result.isError, `${name}: ${result.text}`).toBeFalsy();
      TOOLS[name].output.parse(result.structured);
    }
  });

  test("student B's token never returns A's ids or text", async () => {
    const calls: Array<[string, unknown]> = [
      ["list_courses", {}],
      ["get_recent_notes", { course: courseAName }],
      ["get_note_pages", { fileId: fileAId }],
      ["search_notes", { query: secretA }],
      ["get_deadlines", {}],
      ["get_grades", {}],
      ["get_crunch_weeks", {}],
    ];
    const blobs: string[] = [];
    for (const [name, args] of calls) {
      const result = await callTool(tokenB, name, args);
      blobs.push(result.text, JSON.stringify(result.structured ?? null));
    }
    const blob = blobs.join("\n");
    // courseAName is not checked: B sent it, and course_not_found echoes the requested name.
    for (const secret of [secretA, courseAId, fileAId, studentA!.id]) {
      expect(blob).not.toContain(secret);
    }
  });

  test("RLS is in force on the oauth db client: B cannot read A's courses directly", async () => {
    const request = new Request(`${APP_URL}/api/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    const auth = await authenticate(request, config());
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    expect(auth.method).toBe("oauth");
    expect(auth.studentId).toBe(studentB!.id);

    const { data, error } = await auth.db.from("courses").select("id").eq("student_id", studentA!.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  test("401 with the resource_metadata challenge for bad credentials", async () => {
    const env = dbEnv();
    const body = rpcBody("tools/call", { name: "list_courses", arguments: {} });

    const none = await postMcp(config(), body);
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toBe(CHALLENGE);

    const tampered = tamperSignature(tokenA);
    expect(tampered).not.toBe(tokenA);
    for (const [label, token] of [
      ["garbage", "garbage-token-value-not-a-jwt"],
      ["garbage jwt shape", "aaaa.bbbb.cccc"],
      ["tampered signature", tampered],
      ["anon key", env.anonKey],
      ["service role key", env.serviceRoleKey],
    ] as const) {
      const response = await postMcp(config(), body, `Bearer ${token}`);
      expect(response.status, label).toBe(401);
      expect(response.headers.get("www-authenticate"), label).toBe(INVALID_CHALLENGE);
      await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    }
  });

  test("the demo bearer still works and wins when it would also be a valid user token", async () => {
    const request = new Request(`${APP_URL}/api/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokenA}` },
    });
    const auth = await authenticate(request, config({ demoToken: tokenA }));
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    expect(auth.method).toBe("demo");
    expect(auth.studentId).toBe(DEMO_STUDENT);
  });
});
