import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getAssignment, getDeadlines, TOOL_HANDLERS } from "../../src/tools";
import { SKIP_DB_TESTS, dbEnv } from "../db-env";
import { createThrowawayUser, deleteUsers, must, serviceClient, type TestUser } from "../db/helpers";
import { createCourse, makeCtx, uniqueName } from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(SKIP_DB_TESTS)("get_assignment", () => {
  let service: SupabaseClient;
  let studentA: TestUser | undefined;
  let studentB: TestUser | undefined;
  let courseName = "";
  let assignmentId = "";
  let bigAssignmentId = "";
  let bareAssignmentId = "";
  let hugeAssignmentId = "";
  const fileIds: Record<string, string> = {};

  const contextsForA = () => [makeCtx(studentA!.client, studentA!.id), makeCtx(service, studentA!.id)];
  const contextsForB = () => [makeCtx(studentB!.client, studentB!.id), makeCtx(service, studentB!.id)];

  async function createAssignment(
    studentId: string,
    courseId: string,
    title: string,
    description: string | null,
  ): Promise<string> {
    const row = must(
      await service
        .from("assignments")
        .insert({
          student_id: studentId,
          course_id: courseId,
          title,
          description,
          due_at: new Date(Date.now() + 5 * DAY_MS).toISOString(),
          points_possible: 50,
        })
        .select("id")
        .single(),
      "create assignment",
    ) as { id: string };
    return row.id;
  }

  async function createAttachment(
    studentId: string,
    forAssignment: string,
    title: string,
    fileType: string,
    status: string,
    pages: string[],
  ): Promise<string> {
    const row = must(
      await service
        .from("assignment_files")
        .insert({
          student_id: studentId,
          assignment_id: forAssignment,
          canvas_file_id: randomUUID(),
          title,
          file_type: fileType,
          ingest_status: status,
          page_count: status === "ready" ? pages.length : null,
        })
        .select("id")
        .single(),
      "create attachment",
    ) as { id: string };
    if (pages.length > 0) {
      must(
        await service
          .from("assignment_file_pages")
          .insert(
            pages.map((text, index) => ({
              student_id: studentId,
              assignment_file_id: row.id,
              page_number: index + 1,
              text,
            })),
          )
          .select("id"),
        "insert attachment pages",
      );
    }
    return row.id;
  }

  beforeAll(async () => {
    service = serviceClient();
    studentA = await createThrowawayUser(service, "Assignment Student A");
    studentB = await createThrowawayUser(service, "Assignment Student B");
    const course = await createCourse(service, studentA.id, uniqueName("Business 350"));
    courseName = course.name;

    assignmentId = await createAssignment(studentA.id, course.id, "BIA Project Milestone", "Read the brief.");
    // Inserted out of title order; the tool returns them by title.
    fileIds.data = await createAttachment(studentA.id, assignmentId, "D data.xlsx", "other", "skipped", []);
    fileIds.brief = await createAttachment(studentA.id, assignmentId, "B brief.pdf", "pdf", "ready", [
      "Brief page one.",
      "Brief page two.",
    ]);
    // A stray page on a pending file must not be returned.
    fileIds.pending = await createAttachment(studentA.id, assignmentId, "C rubric.pdf", "pdf", "pending", [
      "not ready yet",
    ]);
    fileIds.prompt = await createAttachment(studentA.id, assignmentId, "A prompt.docx", "docx", "ready", [
      "Prompt text.",
    ]);

    bigAssignmentId = await createAssignment(studentA.id, course.id, "Case Study", "i".repeat(20_000));
    fileIds.big = await createAttachment(studentA.id, bigAssignmentId, "Case.pdf", "pdf", "ready", [
      "a".repeat(20_000),
      "b".repeat(20_000),
      "c".repeat(20_000),
    ]);
    bareAssignmentId = await createAssignment(studentA.id, course.id, "Reading Quiz", null);

    hugeAssignmentId = await createAssignment(studentA.id, course.id, "Huge Handout", null);
    fileIds.huge = await createAttachment(
      studentA.id,
      hugeAssignmentId,
      "A huge.pdf",
      "pdf",
      "ready",
      Array.from({ length: 300 }, (_, index) => `${index + 1}`.padEnd(1_000, "x")),
    );
    fileIds.after = await createAttachment(studentA.id, hugeAssignmentId, "B after.pdf", "pdf", "ready", ["after"]);
  });

  afterAll(async () => {
    if (service) await deleteUsers(service, [studentA, studentB]);
  });

  test("returns the assignment, its instructions and ready attachment pages by title", async () => {
    for (const ctx of contextsForA()) {
      const output = await getAssignment(ctx, { assignmentId });
      expect(output).toMatchObject({
        assignmentId,
        courseName,
        title: "BIA Project Milestone",
        points: 50,
        status: "upcoming",
        instructions: "Read the brief.",
        url: `http://localhost:3005/assignments/${assignmentId}`,
        truncated: false,
      });
      expect(output.attachments.map((a) => [a.title, a.fileType, a.status, a.pageCount])).toEqual([
        ["A prompt.docx", "docx", "ready", 1],
        ["B brief.pdf", "pdf", "ready", 2],
        ["C rubric.pdf", "pdf", "pending", null],
        ["D data.xlsx", "other", "skipped", null],
      ]);
      expect(output.attachments[0]!.url).toBe(
        `http://localhost:3005/assignments/${assignmentId}/files/${fileIds.prompt}`,
      );
      expect(output.attachments[0]!.pages).toEqual([{ page: 1, text: "Prompt text." }]);
      expect(output.attachments[1]!.pages).toEqual([
        { page: 1, text: "Brief page one." },
        { page: 2, text: "Brief page two." },
      ]);
      expect(output.attachments[2]!.pages).toEqual([]);
      expect(output.attachments[3]!.pages).toEqual([]);
    }
  });

  test("an assignment with no description or files returns null instructions and no attachments", async () => {
    const output = await getAssignment(contextsForA()[0]!, { assignmentId: bareAssignmentId });
    expect(output.instructions).toBeNull();
    expect(output.attachments).toEqual([]);
    expect(output.truncated).toBe(false);
  });

  test("instructions and pages share the text cap; pages past it are left out", async () => {
    const [ctx] = contextsForA();
    // "Read the brief." (15) + "Prompt text." (12) + "Brief page one." (15) = 42; page two would pass 50.
    const capped = await getAssignment(ctx!, { assignmentId }, { textCapChars: 50 });
    expect(capped.truncated).toBe(true);
    expect(capped.attachments.map((a) => a.pages.map((p) => p.page))).toEqual([[1], [1], [], []]);
    expect(capped.attachments).toHaveLength(4);

    // Real cap (60k): 20k instructions + two 20k pages = 60k fit; the third page does not.
    const big = await getAssignment(ctx!, { assignmentId: bigAssignmentId });
    expect(big.truncated).toBe(true);
    expect(big.instructions).toHaveLength(20_000);
    expect(big.attachments[0]!.pageCount).toBe(3);
    expect(big.attachments[0]!.pages.map((p) => p.page)).toEqual([1, 2]);
  });

  test("a huge attachment stops reading pages once the cap is reached", async () => {
    let requests = 0;
    let rowsFetched = 0;
    const env = dbEnv();
    const counting = createClient(env.url, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          if (String(input).includes("/rest/v1/assignment_file_pages")) {
            requests += 1;
            const rows: unknown = await response.clone().json();
            if (Array.isArray(rows)) rowsFetched += rows.length;
          }
          return response;
        },
      },
    });

    const output = await getAssignment(makeCtx(counting, studentA!.id), { assignmentId: hugeAssignmentId });
    // 60 pages of 1,000 chars fill the 60k cap exactly; page 61 does not fit.
    expect(output.truncated).toBe(true);
    expect(output.attachments[0]!.pageCount).toBe(300);
    expect(output.attachments[0]!.pages.map((p) => p.page)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(output.attachments[1]!.pages).toEqual([]);
    // Two 50-row ranges of the huge file, and nothing from the attachment after it.
    expect(requests).toBe(2);
    expect(rowsFetched).toBe(100);
  });

  test("another student's or an unknown assignment id is not found", async () => {
    for (const ctx of contextsForB()) {
      await expect(getAssignment(ctx, { assignmentId })).rejects.toMatchObject({ code: "assignment_not_found" });
    }
    await expect(getAssignment(contextsForA()[0]!, { assignmentId: randomUUID() })).rejects.toMatchObject({
      code: "assignment_not_found",
    });
  });

  test("TOOL_HANDLERS.get_assignment validates input", async () => {
    const ctx = contextsForA()[0]!;
    await expect(TOOL_HANDLERS.get_assignment(ctx, { assignmentId: "a1" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    const output = await TOOL_HANDLERS.get_assignment(ctx, { assignmentId: bareAssignmentId });
    expect(output.title).toBe("Reading Quiz");
  });

  test("get_deadlines counts each assignment's attachments", async () => {
    for (const ctx of contextsForA()) {
      const output = await getDeadlines(ctx, { daysAhead: 30 });
      const counts = Object.fromEntries(output.deadlines.map((d) => [d.title, d.attachmentCount]));
      expect(counts).toEqual({ "BIA Project Milestone": 4, "Case Study": 1, "Reading Quiz": 0, "Huge Handout": 2 });
    }
    for (const ctx of contextsForB()) {
      expect((await getDeadlines(ctx, { daysAhead: 30 })).deadlines).toEqual([]);
    }
  });
});
