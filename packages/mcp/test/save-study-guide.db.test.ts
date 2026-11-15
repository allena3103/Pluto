import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { PlutoDb } from "@pluto/core/context";
import { consumeMagicLink } from "@pluto/core/magic-links";
import type { McpHandlerConfig } from "../src/handler";
import { SKIP_DB_TESTS, dbEnv } from "./db-env";
import {
  createCourse,
  createFile,
  createThrowawayUser,
  deleteUsers,
  must,
  serviceClient,
  uniqueName,
  type TestUser,
} from "./db-helpers";
import { mcpResult, postMcp, rpcBody } from "./request";

const APP_URL = "http://127.0.0.1:3601";
const TOKEN = "pluto-mcp-save-db-test-token-32chars";

type SaveResult = {
  noteId: string;
  title: string;
  courseName: string | null;
  url: string;
  citedPages: number;
  textStatus: "sent" | "no_phone" | "failed";
};

function baseConfig(studentId: string, overrides: Partial<McpHandlerConfig> = {}): McpHandlerConfig {
  const env = dbEnv();
  return {
    supabaseUrl: env.url,
    supabaseAnonKey: env.anonKey,
    supabaseServiceRoleKey: env.serviceRoleKey,
    appUrl: APP_URL,
    demoToken: TOKEN,
    demoStudentId: studentId,
    sms: { provider: "simulator" },
    ...overrides,
  };
}

async function call(
  config: McpHandlerConfig,
  args: unknown,
  auth: { bearer?: string; urlToken?: string },
): Promise<{ isError?: boolean; text: string; structured?: SaveResult }> {
  const response = await postMcp(
    config,
    rpcBody("tools/call", { name: "save_study_guide", arguments: args }),
    auth.bearer === undefined ? undefined : `Bearer ${auth.bearer}`,
    `${APP_URL}/api/mcp`,
    auth.urlToken === undefined ? undefined : { urlToken: auth.urlToken },
  );
  const { status, body } = await mcpResult(response);
  expect(status, JSON.stringify(body)).toBe(200);
  const result = body.result as {
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: SaveResult;
  };
  const text = result.content?.find((block) => block.type === "text")?.text ?? "";
  return { isError: result.isError, text, structured: result.structuredContent };
}

function link(fileId: string, page: number, origin = APP_URL): string {
  return `${origin}/notes/${fileId}?page=${page}`;
}

function testPhone(): string {
  return `+1555${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
}

describe.skipIf(SKIP_DB_TESTS)("save_study_guide against local supabase", () => {
  let service: SupabaseClient;
  let studentA: TestUser | undefined;
  let studentB: TestUser | undefined;
  let studentC: TestUser | undefined;
  let phoneA = "";
  let courseA = { id: "", name: "" };
  let courseA2 = { id: "", name: "" };
  let fileA1 = "";
  let fileA2 = "";
  let fileA3 = "";
  let fileB = "";

  beforeAll(async () => {
    service = serviceClient();
    studentA = await createThrowawayUser(service, "Save Student A");
    studentB = await createThrowawayUser(service, "Save Student B");
    studentC = await createThrowawayUser(service, "Save Student C (no phone)");

    phoneA = testPhone();
    must(await service.from("profiles").update({ phone: phoneA }).eq("id", studentA.id).select("id"), "set phone A");
    must(await service.from("profiles").update({ phone: testPhone() }).eq("id", studentB.id).select("id"), "set phone B");

    courseA = await createCourse(service, studentA.id, uniqueName("History 105"));
    courseA2 = await createCourse(service, studentA.id, uniqueName("Biology 110"));
    fileA1 = (await createFile(service, { studentId: studentA.id, courseId: courseA.id, title: "Week 9", pageCount: 5 })).id;
    fileA2 = (await createFile(service, { studentId: studentA.id, courseId: courseA.id, title: "Week 10", pageCount: 3 })).id;
    fileA3 = (await createFile(service, { studentId: studentA.id, courseId: courseA2.id, title: "Cells", pageCount: 2 })).id;
    const courseB = await createCourse(service, studentB.id, uniqueName("History 105"));
    fileB = (await createFile(service, { studentId: studentB.id, courseId: courseB.id, title: "B notes", pageCount: 9 })).id;
  });

  afterAll(async () => {
    await deleteUsers(service, [studentA, studentB, studentC]);
  });

  async function smsRows(studentId: string): Promise<Array<{ body: string; direction: string; phone: string }>> {
    return must(
      await service.from("sms_messages").select("body, direction, phone").eq("student_id", studentId),
      "sms rows",
    ) as Array<{ body: string; direction: string; phone: string }>;
  }

  async function mcpNoteCount(studentId: string): Promise<number> {
    const { count, error } = await service
      .from("saved_notes")
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId)
      .eq("source", "mcp");
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  test("demo bearer: saves own cited pages only, files the class, texts a saved-note magic link", async () => {
    const markdown = [
      "# History 105 study guide",
      `- Treaty terms ([notes](${link(fileA1, 2)}))`,
      `- Same page again ([notes](${link(fileA1, 2)}))`,
      `- Causes: ${link(fileA2, 3)}.`,
      `- Beyond the last page ([notes](${link(fileA1, 99)}))`,
      `- Other student's file ([notes](${link(fileB, 1)}))`,
      `- Foreign origin ([notes](${link(fileA1, 4, "https://evil.example")}))`,
    ].join("\n");

    const before = (await smsRows(studentA!.id)).length;
    const { isError, text, structured } = await call(
      baseConfig(studentA!.id),
      { title: "History 105 study guide", markdown },
      { bearer: TOKEN },
    );
    expect(isError, text).toBeFalsy();
    expect(structured).toMatchObject({
      title: "History 105 study guide",
      courseName: courseA.name,
      citedPages: 2,
      textStatus: "sent",
    });
    expect(structured!.url).toBe(`${APP_URL}/notes/saved/${structured!.noteId}`);
    expect(text).not.toContain(fileB);

    const row = must(
      await service.from("saved_notes").select("*").eq("id", structured!.noteId).single(),
      "saved row",
    ) as Record<string, unknown>;
    expect(row.student_id).toBe(studentA!.id);
    expect(row.source).toBe("mcp");
    expect(row.course_id).toBe(courseA.id);
    expect(row.session_id).toBeNull();
    expect(row.body).toBe(markdown);
    expect(row.sources).toEqual([
      { fileId: fileA1, page: 2 },
      { fileId: fileA2, page: 3 },
    ]);
    expect(JSON.stringify(row.sources)).not.toContain(fileB);

    const sms = await smsRows(studentA!.id);
    expect(sms.length).toBe(before + 1);
    const out = sms.find((m) => m.direction === "outbound" && m.body.includes("/open/"));
    expect(out?.phone).toBe(phoneA);
    expect(out?.body).toMatch(/^Pluto: your study guide "History 105 study guide" is saved\. Open it: http:\/\/127\.0\.0\.1:3601\/open\/[A-Za-z0-9_-]+$/);

    // The texted link opens the saved note once.
    const token = /\/open\/([A-Za-z0-9_-]+)$/.exec(out!.body)![1]!;
    const admin = service as unknown as PlutoDb;
    const consumed = await consumeMagicLink(admin, token);
    expect(consumed).toEqual({
      kind: "saved_note",
      studentId: studentA!.id,
      savedNoteId: structured!.noteId,
      redirectPath: `/notes/saved/${structured!.noteId}`,
    });
    expect(await consumeMagicLink(admin, token)).toBeNull();
  });

  test("course input wins; cited files across classes without course input give no class", async () => {
    const markdown = `[a](${link(fileA1, 1)}) [b](${link(fileA3, 1)})`;
    const mixed = await call(baseConfig(studentA!.id), { title: "Mixed", markdown }, { bearer: TOKEN });
    expect(mixed.isError, mixed.text).toBeFalsy();
    expect(mixed.structured).toMatchObject({ courseName: null, citedPages: 2 });

    const named = await call(
      baseConfig(studentA!.id),
      { title: "Named", markdown, course: courseA2.name },
      { bearer: TOKEN },
    );
    expect(named.isError, named.text).toBeFalsy();
    expect(named.structured?.courseName).toBe(courseA2.name);

    const missing = await call(
      baseConfig(studentA!.id),
      { title: "Missing", markdown, course: "No Such Course 999" },
      { bearer: TOKEN },
    );
    expect(missing.isError).toBe(true);
    expect(missing.text.startsWith("course_not_found:")).toBe(true);
  });

  test("another student's course name is not resolvable", async () => {
    const result = await call(
      baseConfig(studentC!.id),
      { title: "x", markdown: "body", course: courseA.name },
      { bearer: TOKEN },
    );
    expect(result.isError).toBe(true);
    expect(result.text.startsWith("course_not_found:")).toBe(true);
  });

  test("no phone: saved with textStatus no_phone and no SMS row", async () => {
    const result = await call(baseConfig(studentC!.id), { title: "Guide", markdown: "# Guide\nbody" }, { bearer: TOKEN });
    expect(result.isError, result.text).toBeFalsy();
    expect(result.structured).toMatchObject({ textStatus: "no_phone", citedPages: 0, courseName: null });
    expect(await smsRows(studentC!.id)).toEqual([]);
    const { count } = await service
      .from("magic_links")
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentC!.id);
    expect(count).toBe(0);
  });

  test("invalid input is invalid_input and saves nothing", async () => {
    const before = await mcpNoteCount(studentC!.id);
    const result = await call(baseConfig(studentC!.id), { title: "", markdown: "" }, { bearer: TOKEN });
    expect(result.isError).toBe(true);
    expect(result.text.startsWith("invalid_input:")).toBe(true);
    expect(await mcpNoteCount(studentC!.id)).toBe(before);
  });

  test("a failed text keeps the save and reports failed without leaking provider text", async () => {
    const logged: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
    try {
      const result = await call(
        baseConfig(studentA!.id, { sms: { provider: "sendblue", env: {} } }),
        { title: "Fails to text", markdown: "body" },
        { bearer: TOKEN },
      );
      expect(result.isError, result.text).toBeFalsy();
      expect(result.structured?.textStatus).toBe("failed");
      const row = await service.from("saved_notes").select("id").eq("id", result.structured!.noteId).maybeSingle();
      expect(row.data?.id).toBe(result.structured!.noteId);
      const text = JSON.stringify(logged);
      expect(text).not.toContain(phoneA);
      expect(text).not.toContain("/open/");
      expect(text).not.toContain("SENDBLUE");
    } finally {
      spy.mockRestore();
    }
  });

  test("the 11th MCP save in an hour is rate_limited, saves and texts nothing, and never builds the service client", async () => {
    // Start from a clean hour for student B, then add up to 10 MCP rows directly.
    must(
      await service.from("saved_notes").delete().eq("student_id", studentB!.id).eq("source", "mcp").select("id"),
      "clear B",
    );
    const existing = await mcpNoteCount(studentB!.id);
    const rows = Array.from({ length: 10 - existing }, (_, i) => ({
      student_id: studentB!.id,
      title: `seed ${i}`,
      body: "seed",
      source: "mcp",
    }));
    if (rows.length > 0) must(await service.from("saved_notes").insert(rows).select("id"), "seed rows");
    // A chat-sourced note does not count toward the limit.
    must(
      await service.from("saved_notes").insert({ student_id: studentB!.id, title: "chat", body: "chat" }).select("id"),
      "chat row",
    );

    const smsBefore = (await smsRows(studentB!.id)).length;
    const createAdmin = vi.fn(() => service as unknown as PlutoDb);
    const result = await call(
      baseConfig(studentB!.id, { createAdmin }),
      { title: "One too many", markdown: "body" },
      { bearer: TOKEN },
    );
    expect(result.isError).toBe(true);
    expect(result.text.startsWith("rate_limited:")).toBe(true);
    expect(createAdmin).not.toHaveBeenCalled();
    expect(await mcpNoteCount(studentB!.id)).toBe(10);
    expect((await smsRows(studentB!.id)).length).toBe(smsBefore);

    // Rows older than an hour no longer count.
    must(
      await service
        .from("saved_notes")
        .update({ created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() })
        .eq("student_id", studentB!.id)
        .eq("source", "mcp")
        .select("id"),
      "age rows",
    );
    const after = await call(baseConfig(studentB!.id), { title: "Allowed again", markdown: "body" }, { bearer: TOKEN });
    expect(after.isError, after.text).toBeFalsy();
  });

  test("OAuth: saves with the student's own token under RLS; other students cannot see it", async () => {
    const { data } = await studentA!.client.auth.getSession();
    const accessToken = data.session!.access_token;
    const createAdmin = vi.fn(() => service as unknown as PlutoDb);
    const result = await call(
      baseConfig(studentA!.id, { demoToken: undefined, demoStudentId: studentC!.id, createAdmin }),
      { title: "OAuth guide", markdown: `[p](${link(fileA2, 1)}) [x](${link(fileB, 2)})` },
      { bearer: accessToken },
    );
    expect(result.isError, result.text).toBeFalsy();
    expect(result.structured).toMatchObject({ citedPages: 1, courseName: courseA.name, textStatus: "sent" });
    expect(createAdmin).toHaveBeenCalledTimes(1);

    const own = await studentA!.client.from("saved_notes").select("id, source, student_id").eq("id", result.structured!.noteId);
    expect(own.data).toEqual([{ id: result.structured!.noteId, source: "mcp", student_id: studentA!.id }]);
    const other = await studentB!.client.from("saved_notes").select("id").eq("id", result.structured!.noteId);
    expect(other.data ?? []).toEqual([]);
    const linksSeenByB = await studentB!.client.from("magic_links").select("id");
    expect(linksSeenByB.data ?? []).toEqual([]);
  });

  test("demo URL token saves when the flag is 1, and is 404 when the flag is off", async () => {
    const on = await call(
      baseConfig(studentC!.id, { demoUrlFlag: "1" }),
      { title: "URL mode", markdown: "body" },
      { urlToken: TOKEN },
    );
    expect(on.isError, on.text).toBeFalsy();
    expect(on.structured?.textStatus).toBe("no_phone");

    const off = await postMcp(
      baseConfig(studentC!.id),
      rpcBody("tools/call", { name: "save_study_guide", arguments: { title: "x", markdown: "y" } }),
      undefined,
      `${APP_URL}/api/mcp`,
      { urlToken: TOKEN },
    );
    expect(off.status).toBe(404);
  });

  test("a saved-note magic link cannot point at another student's note", async () => {
    const noteB = must(
      await service.from("saved_notes").insert({ student_id: studentB!.id, title: "B", body: "B" }).select("id").single(),
      "note B",
    ) as { id: string };
    const { error } = await service.from("magic_links").insert({
      student_id: studentA!.id,
      saved_note_id: noteB.id,
      token_hash: `test-${uniqueName("hash")}`,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(error?.code).toBe("23503");

    const noteA = must(
      await service.from("saved_notes").insert({ student_id: studentA!.id, title: "A", body: "A" }).select("id").single(),
      "note A",
    ) as { id: string };
    const both = await service.from("magic_links").insert({
      student_id: studentA!.id,
      file_id: fileA1,
      saved_note_id: noteA.id,
      token_hash: `test-${uniqueName("hash")}`,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(both.error?.code).toBe("23514");
    const neither = await service.from("magic_links").insert({
      student_id: studentA!.id,
      token_hash: `test-${uniqueName("hash")}`,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(neither.error?.code).toBe("23514");
  });
});
