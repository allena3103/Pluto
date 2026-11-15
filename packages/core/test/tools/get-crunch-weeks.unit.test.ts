import { describe, expect, test } from "vitest";
import { buildCrunchWeeks, utcMondayStart } from "../../src/tools/get-crunch-weeks";

describe("utcMondayStart", () => {
  test("returns UTC Monday for any day in week", () => {
    const tuesday = new Date("2026-11-17T20:00:00Z");
    expect(utcMondayStart(tuesday).toISOString()).toBe("2026-11-16T00:00:00.000Z");
    const sunday = new Date("2026-11-22T10:00:00Z");
    expect(utcMondayStart(sunday).toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });
});

describe("buildCrunchWeeks", () => {
  test("ranks heavier week first and breaks ties by earlier week", () => {
    const rows = [
      {
        id: "a1",
        course_id: "c1",
        title: "Midterm",
        due_at: "2026-11-18T12:00:00Z",
        previous_due_at: null,
        graded: false,
        submitted: false,
        points_possible: 200,
        grade_group_id: "g1",
        courses: { name: "History 105" },
        grade_groups: { name: "Exams", weight_percent: 60 },
        assignment_files: [{ count: 2 }],
      },
      {
        id: "a2",
        course_id: "c1",
        title: "Essay",
        due_at: "2026-11-19T12:00:00Z",
        previous_due_at: null,
        graded: false,
        submitted: false,
        points_possible: 100,
        grade_group_id: "g2",
        courses: { name: "History 105" },
        grade_groups: { name: "Essays", weight_percent: 40 },
        assignment_files: [{ count: 0 }],
      },
      {
        id: "a3",
        course_id: "c1",
        title: "Quiz",
        due_at: "2026-11-25T12:00:00Z",
        previous_due_at: null,
        graded: false,
        submitted: false,
        points_possible: 25,
        grade_group_id: "g1",
        courses: { name: "History 105" },
        grade_groups: { name: "Exams", weight_percent: 60 },
        assignment_files: [{ count: 0 }],
      },
    ];

    const totals = new Map<string, number>([
      ["g1", 400],
      ["g2", 200],
    ]);
    const output = buildCrunchWeeks(rows, totals);
    expect(output[0]!.weekStart).toBe("2026-11-16");
    expect(output[0]!.deliverableCount).toBe(2);
    expect(output[0]!.totalWeightPercent).toBe(50);
    expect(output[1]!.weekStart).toBe("2026-11-23");
  });
});
