import { describe, expect, it } from "vitest";
import { createCanvasClient } from "../../src/client";

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
});
