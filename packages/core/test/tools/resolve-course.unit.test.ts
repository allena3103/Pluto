import { describe, expect, test } from "vitest";
import { matchCourse } from "../../src/tools/resolve-course";

const courses = [
  { courseId: "11111111-1111-4111-8111-111111111111", name: "History 105", term: "Fall 2026" },
  { courseId: "22222222-2222-4222-8222-222222222222", name: "Biology 201", term: "Fall 2026" },
  { courseId: "33333333-3333-4333-8333-333333333333", name: "History of Science", term: "Fall 2026" },
];

describe("matchCourse", () => {
  test("matches by exact id first", () => {
    const result = matchCourse(courses, "11111111-1111-4111-8111-111111111111");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.course.name).toBe("History 105");
  });

  test("matches exact case-insensitive name", () => {
    const result = matchCourse(courses, "history 105");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.course.courseId).toBe(courses[0]!.courseId);
  });

  test("matches unique substring", () => {
    const result = matchCourse(courses, "biology");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.course.name).toBe("Biology 201");
  });

  test("returns ambiguous for non-unique substring", () => {
    const result = matchCourse(courses, "history");
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") return;
    expect(result.message).toContain("Available courses");
  });

  test("returns not_found with available course names", () => {
    const result = matchCourse(courses, "chemistry");
    expect(result.kind).toBe("not_found");
    if (result.kind !== "not_found") return;
    expect(result.message).toContain("History 105");
  });
});
