import { describe, expect, it } from "vitest";
import { createCanvasClient } from "../../src/client";
import { classifyFileType, linkedFileIds } from "../../src/map";
import { CanvasNotFoundError } from "../../src/types";

describe("canvas fixtures mode", () => {
  it("returns seeded courses, groups, assignments and pdf files", async () => {
    const client = createCanvasClient({
      baseUrl: "https://fixtures.canvas.local",
      token: "unused",
      mode: "fixtures",
    });

    const courses = await client.listCourses();
    expect(courses.map((course) => course.canvasCourseId)).toEqual([
      "seed-hist-105",
      "seed-bio-151",
      "seed-stat-240",
    ]);

    const histGroups = await client.listAssignmentGroups("seed-hist-105");
    expect(histGroups.map((group) => group.canvasGroupId)).toEqual([
      "seed-hist-responses",
      "seed-hist-essays",
      "seed-hist-exams",
    ]);

    const histAssignments = await client.listAssignments("seed-hist-105");
    expect(histAssignments.map((assignment) => assignment.canvasAssignmentId)).toEqual([
      "seed-101",
      "seed-102",
      "seed-103",
      "seed-104",
    ]);

    const filesByCourse = await Promise.all(
      courses.map(async (course) => [course.canvasCourseId, await client.listCourseFiles(course.canvasCourseId)] as const),
    );
    for (const [courseId, files] of filesByCourse) {
      expect(files.length).toBeGreaterThan(0);
      expect(files.some((file) => file.url.includes("fixtures.canvas.local"))).toBe(true);
      expect(files.every((file) => file.canvasFileId.length > 0)).toBe(true);
      expect(courseId.length).toBeGreaterThan(0);
    }

    const moduleItems = await client.listModuleItems("seed-hist-105");
    expect(moduleItems).toContainEqual({
      moduleName: "Week 7: Primary Sources",
      canvasFileId: "hist-file-1",
    });
  });

  it("links a PDF, a Word file and a spreadsheet from the Project Proposal description", async () => {
    const client = createCanvasClient({ baseUrl: "https://fixtures.canvas.local", token: "unused", mode: "fixtures" });
    const proposal = (await client.listAssignments("seed-stat-240")).find((row) => row.canvasAssignmentId === "seed-123");
    expect(proposal?.htmlUrl).toBe("https://fixtures.canvas.local/courses/seed-stat-240/assignments/seed-123");

    const ids = linkedFileIds(proposal?.descriptionHtml ?? null, "seed-stat-240");
    expect(ids).toEqual(["24001", "24002", "24003"]);
    const files = await Promise.all(ids.map((id) => client.getCourseFile("seed-stat-240", id)));
    expect(files.map((file) => file && [file.title, classifyFileType(file)])).toEqual([
      ["Project Proposal Guidelines.pdf", "pdf"],
      ["Proposal Template.docx", "docx"],
      ["Data Dictionary.xlsx", "other"],
    ]);
    // Attachments are not notes: none of them is in the course's file listing.
    const notes = await client.listCourseFiles("seed-stat-240");
    expect(notes.some((file) => ids.includes(file.canvasFileId))).toBe(false);
    await expect(client.getCourseFile("seed-stat-240", "24004")).resolves.toBeNull();
  });

  it("resolves seeded due_at templates to exact UTC instants", async () => {
    const client = createCanvasClient({
      baseUrl: "https://fixtures.canvas.local",
      token: "unused",
      mode: "fixtures",
      now: () => new Date("2026-11-14T12:00:00Z"),
    });

    const historyAssignments = await client.listAssignments("seed-hist-105");
    expect(findDueAt(historyAssignments, "seed-101")).toBe("2026-11-20T04:59:00Z");
    expect(findDueAt(historyAssignments, "seed-102")).toBe("2026-11-26T04:59:00Z");
    expect(findDueAt(historyAssignments, "seed-103")).toBe("2026-12-04T04:59:00Z");
  });

  it("returns CanvasNotFoundError when the fixture file is missing", async () => {
    const client = createCanvasClient({
      baseUrl: "https://fixtures.canvas.local",
      token: "unused",
      mode: "fixtures",
    });

    let error: unknown;
    try {
      await client.listAssignmentGroups("missing-course-id");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CanvasNotFoundError);
    const notFound = error as CanvasNotFoundError;
    expect(notFound.status).toBe(404);
    expect(notFound.message.includes("ENOENT")).toBe(false);
    expect("code" in notFound && (notFound as { code?: string }).code === "ENOENT").toBe(false);
  });

  it("handles DST transitions when resolving due_at templates", async () => {
    const client = createCanvasClient({
      baseUrl: "https://fixtures.canvas.local",
      token: "unused",
      mode: "fixtures",
      now: () => new Date("2026-10-31T12:00:00Z"),
    });

    const bioAssignments = await client.listAssignments("seed-bio-151");
    expect(findDueAt(bioAssignments, "seed-111")).toBe("2026-11-04T04:59:00Z");
  });
});

function findDueAt(
  assignments: Array<{ canvasAssignmentId: string; dueAt: string | null }>,
  assignmentId: string,
): string | null {
  const assignment = assignments.find((item) => item.canvasAssignmentId === assignmentId);
  if (!assignment) {
    throw new Error(`Missing assignment: ${assignmentId}`);
  }
  return assignment.dueAt;
}
