import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  getCrunchWeeks,
  getDeadlines,
  getGrades,
  getNotePages,
  getRecentNotes,
  listCourses,
  searchNotes,
  TOOL_HANDLERS,
  ToolError,
} from "../../src/tools";
import { SKIP_DB_TESTS } from "../db-env";
import { createThrowawayUser, deleteUsers, must, serviceClient, type TestUser } from "../db/helpers";
import { createCourse, createFile, insertPages, makeCtx, uniqueName } from "./helpers";

const CAP = 70;

describe.skipIf(SKIP_DB_TESTS)("tools integration", () => {
  let service: SupabaseClient;
  let studentA: TestUser | undefined;
  let studentB: TestUser | undefined;
  let courseAHistoryId = "";
  let courseABioId = "";
  let courseAHistoryAltId = "";
  let courseBId = "";
  let fileHistoryRecentId = "";
  let fileHistoryOldId = "";
  let fileMassiveId = "";
  let fileBId = "";
  let heavyWeekStart = "";

  const contextsForA = () => [makeCtx(studentA!.client, studentA!.id), makeCtx(service, studentA!.id)];
  const contextsForB = () => [makeCtx(studentB!.client, studentB!.id), makeCtx(service, studentB!.id)];

  beforeAll(async () => {
    service = serviceClient();
    studentA = await createThrowawayUser(service, "Tools Student A");
    studentB = await createThrowawayUser(service, "Tools Student B");

    const history = await createCourse(service, studentA.id, uniqueName("History 105"));
    const historyAlt = await createCourse(service, studentA.id, uniqueName("History of Art"));
    const bio = await createCourse(service, studentA.id, uniqueName("Biology 201"));
    const other = await createCourse(service, studentB.id, uniqueName("Other Course"));
    courseAHistoryId = history.id;
    courseAHistoryAltId = historyAlt.id;
    courseABioId = bio.id;
    courseBId = other.id;

    const now = Date.now();
    fileHistoryRecentId = (
      await createFile(service, {
        studentId: studentA.id,
        courseId: courseAHistoryId,
        title: "Lecture Recent",
        addedAt: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
        pageCount: 3,
      })
    ).id;
    fileHistoryOldId = (
      await createFile(service, {
        studentId: studentA.id,
        courseId: courseAHistoryId,
        title: "Lecture Old",
        addedAt: new Date(now - 15 * 24 * 60 * 60 * 1000).toISOString(),
        pageCount: 2,
      })
    ).id;
    fileMassiveId = (
      await createFile(service, {
        studentId: studentA.id,
        courseId: courseAHistoryId,
        title: "Lecture Massive",
        addedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
        pageCount: 1105,
      })
    ).id;
    fileBId = (
      await createFile(service, {
        studentId: studentB.id,
        courseId: courseBId,
        title: "B File",
        pageCount: 1,
      })
    ).id;

    await insertPages(service, studentA.id, fileHistoryRecentId, [
      "First page with marshall-plan-keyword.",
      "Second page summary text.",
      "Third page detail.",
    ]);
    await insertPages(service, studentA.id, fileHistoryOldId, ["old page one", "old page two"]);
    await insertPages(
      service,
      studentA.id,
      fileMassiveId,
      Array.from({ length: 1105 }, (_, index) => `Massive page ${index + 1} ${"x".repeat(70)}`),
    );
    await insertPages(service, studentB.id, fileBId, ["marshall-plan-keyword for student B only"]);

    const essays = must(
      await service
        .from("grade_groups")
        .insert({ student_id: studentA.id, course_id: courseAHistoryId, name: "Essays", weight_percent: 40 })
        .select("id")
        .single(),
      "essays group",
    ) as { id: string };
    const exams = must(
      await service
        .from("grade_groups")
        .insert({ student_id: studentA.id, course_id: courseAHistoryId, name: "Exams", weight_percent: 60 })
        .select("id")
        .single(),
      "exams group",
    ) as { id: string };
    must(
      await service
        .from("grade_groups")
        .insert({ student_id: studentA.id, course_id: courseABioId, name: "Labs", weight_percent: 100 })
        .select("id")
        .single(),
      "labs group",
    );

    const nowDate = new Date();
    const dueInDays = (days: number) => new Date(nowDate.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
    const monday = new Date(nowDate);
    monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7));
    monday.setUTCHours(0, 0, 0, 0);
    heavyWeekStart = monday.toISOString().slice(0, 10);

    must(
      await service
        .from("assignments")
        .insert([
          {
            student_id: studentA.id,
            course_id: courseAHistoryId,
            grade_group_id: essays.id,
            title: "Essay 1",
            points_possible: 100,
            score: 80,
            graded: true,
            submitted: true,
            due_at: dueInDays(-2),
          },
          {
            student_id: studentA.id,
            course_id: courseAHistoryId,
            grade_group_id: essays.id,
            title: "Essay 2",
            points_possible: 50,
            score: 45,
            graded: true,
            submitted: true,
            due_at: dueInDays(2),
            previous_due_at: dueInDays(1),
          },
          {
            student_id: studentA.id,
            course_id: courseAHistoryId,
            grade_group_id: essays.id,
            title: "Essay 3",
            points_possible: 30,
            graded: false,
            submitted: false,
            due_at: dueInDays(5),
          },
          {
            student_id: studentA.id,
            course_id: courseAHistoryId,
            grade_group_id: exams.id,
            title: "Midterm",
            points_possible: 200,
            score: 150,
            graded: true,
            submitted: true,
            due_at: new Date(monday.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(),
          },
          {
            student_id: studentA.id,
            course_id: courseAHistoryId,
            grade_group_id: exams.id,
            title: "Final Prep",
            points_possible: 100,
            graded: false,
            submitted: true,
            due_at: new Date(monday.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          },
          {
            student_id: studentA.id,
            course_id: courseAHistoryId,
            title: "No Group Assignment",
            points_possible: 10,
            graded: false,
            submitted: false,
            due_at: dueInDays(6),
          },
        ])
        .select("id"),
      "assignments A",
    );

    must(
      await service
        .from("assignments")
        .insert({
          student_id: studentB.id,
          course_id: courseBId,
          title: "Other Student Work",
          points_possible: 10,
          graded: false,
          submitted: false,
          due_at: dueInDays(3),
        })
        .select("id"),
      "assignments B",
    );
  });

  afterAll(async () => {
    if (service) await deleteUsers(service, [studentA, studentB]);
  });

  test("listCourses returns only own courses for both client types", async () => {
    for (const ctx of contextsForA()) {
      const output = await listCourses(ctx);
      expect(output.courses.map((course) => course.courseId).sort()).toEqual(
        [courseAHistoryId, courseAHistoryAltId, courseABioId].sort(),
      );
    }
    for (const ctx of contextsForB()) {
      const output = await listCourses(ctx);
      expect(output.courses.map((course) => course.courseId)).toEqual([courseBId]);
    }
  });

  test("resolve behavior errors for missing/ambiguous course", async () => {
    await expect(
      getRecentNotes(contextsForA()[0]!, { course: "history", days: 14 }),
    ).rejects.toMatchObject({ code: "course_ambiguous" });
    await expect(
      getRecentNotes(contextsForA()[0]!, { course: "no-such-course", days: 14 }),
    ).rejects.toMatchObject({ code: "course_not_found" });
  });

  test("getRecentNotes enforces window and truncation without cutting pages", async () => {
    for (const ctx of contextsForA()) {
      const output = await getRecentNotes(ctx, { course: courseAHistoryId, days: 14 }, { textCapChars: CAP });
      expect(output.files.some((file) => file.fileId === fileHistoryOldId)).toBe(false);
      const recent = output.files.find((file) => file.fileId === fileHistoryRecentId);
      expect(recent?.pages.map((page) => page.page)).toEqual([1, 2]);
      expect(output.truncated).toBe(true);
      for (const file of output.files) {
        expect(file.pagesIncluded).toBe(file.pages.length);
      }
    }
  });

  test("getRecentNotes handles >1000 pages and real 60k cap", async () => {
    const output = await getRecentNotes(
      contextsForA()[1]!,
      { course: courseAHistoryId, days: 14 },
      { textCapChars: 60_000 },
    );
    const massive = output.files.find((file) => file.fileId === fileMassiveId);
    expect(massive).toBeDefined();
    expect(massive!.pageCount).toBe(1105);
    expect(massive!.pagesIncluded).toBeGreaterThan(0);
    expect(massive!.pagesIncluded).toBeLessThan(1105);
  });

  test("getNotePages range behavior and file isolation", async () => {
    for (const ctx of contextsForA()) {
      const output = await getNotePages(ctx, { fileId: fileHistoryRecentId, firstPage: 2, lastPage: 3 });
      expect(output.pages.map((page) => page.page)).toEqual([2, 3]);
      expect(output.deepLink.endsWith("?page=2")).toBe(true);
      const empty = await getNotePages(ctx, { fileId: fileHistoryRecentId, firstPage: 99, lastPage: 120 });
      expect(empty.pages).toEqual([]);
    }

    for (const ctx of contextsForB()) {
      await expect(getNotePages(ctx, { fileId: fileHistoryRecentId })).rejects.toMatchObject({
        code: "file_not_found",
      });
    }
  });

  test("searchNotes matches page and link and isolates students", async () => {
    for (const ctx of contextsForA()) {
      const output = await searchNotes(ctx, { query: "marshall-plan-keyword", limit: 10 });
      expect(output.results[0]?.fileId).toBe(fileHistoryRecentId);
      expect(output.results[0]?.page).toBe(1);
      expect(output.results[0]?.deepLink.endsWith("?page=1")).toBe(true);
      expect((await searchNotes(ctx, { query: "   ", limit: 10 })).results).toEqual([]);
    }
    for (const ctx of contextsForB()) {
      const output = await searchNotes(ctx, { query: "marshall-plan-keyword", limit: 10 });
      expect(output.results).toHaveLength(1);
      expect(output.results[0]!.fileId).toBe(fileBId);
    }
  });

  test("getDeadlines sets moved date and statuses", async () => {
    for (const ctx of contextsForA()) {
      const output = await getDeadlines(ctx, { daysAhead: 30 });
      expect(output.deadlines.length).toBeGreaterThan(0);
      const moved = output.deadlines.find((d) => d.title === "Essay 2");
      expect(moved?.previousDueAt).not.toBeNull();
      const statuses = new Set(output.deadlines.map((d) => d.status));
      expect(statuses.has("upcoming")).toBe(true);
      expect(statuses.has("submitted") || statuses.has("graded")).toBe(true);
    }
  });

  test("getGrades computes group and weighted values", async () => {
    for (const ctx of contextsForA()) {
      const output = await getGrades(ctx, { course: courseAHistoryId });
      expect(output.courses).toHaveLength(1);
      const course = output.courses[0]!;
      expect(course.ungradedCount).toBe(2);
      expect(course.groups.map((g) => g.name).sort()).toEqual(["Essays", "Exams"]);
      expect(course.groups.find((g) => g.name === "Essays")?.scorePercent).toBe(83.33);
      expect(course.weightedGradePercent).toBe(78.33);
    }
  });

  test("getCrunchWeeks ranks heavy week first", async () => {
    for (const ctx of contextsForA()) {
      const output = await getCrunchWeeks(ctx, { weeksAhead: 8 });
      expect(output.weeks.length).toBeGreaterThan(0);
      expect(output.weeks[0]!.weekStart).toBe(heavyWeekStart);
      expect(output.weeks[0]!.rank).toBe(1);
    }
  });

  test("TOOL_HANDLERS parse input and output and return invalid_input errors", async () => {
    const ctx = contextsForA()[0]!;
    const list = await TOOL_HANDLERS.list_courses(ctx, {});
    expect(list.courses.length).toBeGreaterThan(0);
    await expect(TOOL_HANDLERS.get_recent_notes(ctx, {})).rejects.toBeInstanceOf(ToolError);
    await expect(TOOL_HANDLERS.search_notes(ctx, { query: "   " })).rejects.toMatchObject({
      code: "invalid_input",
    });
  });

  test("explicit foreign identifiers behave as not found/empty", async () => {
    for (const ctx of contextsForB()) {
      await expect(
        getRecentNotes(ctx, { course: courseAHistoryId, days: 14 }),
      ).rejects.toMatchObject({ code: "course_not_found" });
      await expect(getGrades(ctx, { course: courseAHistoryId })).rejects.toMatchObject({
        code: "course_not_found",
      });
      await expect(getDeadlines(ctx, { course: courseAHistoryId, daysAhead: 30 })).rejects.toMatchObject({
        code: "course_not_found",
      });
    }
  });
});
