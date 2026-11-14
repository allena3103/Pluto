import { describe, expect, test } from "vitest";
import { computeGroupGrades } from "../../src/tools/get-grades";

describe("computeGroupGrades", () => {
  test("calculates group scores and weighted grade", () => {
    const groups = [
      { id: "g1", course_id: "c1", name: "Essays", weight_percent: 40 },
      { id: "g2", course_id: "c1", name: "Exams", weight_percent: 60 },
      { id: "g3", course_id: "c1", name: "Labs", weight_percent: 10 },
    ];
    const assignments = [
      { course_id: "c1", grade_group_id: "g1", graded: true, points_possible: 100, score: 80 },
      { course_id: "c1", grade_group_id: "g1", graded: true, points_possible: 50, score: 45 },
      { course_id: "c1", grade_group_id: "g1", graded: false, points_possible: 20, score: null },
      { course_id: "c1", grade_group_id: "g2", graded: true, points_possible: 200, score: 150 },
      { course_id: "c1", grade_group_id: "g2", graded: false, points_possible: 50, score: null },
      { course_id: "c1", grade_group_id: "g3", graded: false, points_possible: 10, score: null },
    ];

    const output = computeGroupGrades(groups, assignments);
    expect(output.groups).toEqual([
      { name: "Essays", weightPercent: 40, scorePercent: 83.33, gradedCount: 2, ungradedCount: 1 },
      { name: "Exams", weightPercent: 60, scorePercent: 75, gradedCount: 1, ungradedCount: 1 },
      { name: "Labs", weightPercent: 10, scorePercent: null, gradedCount: 0, ungradedCount: 1 },
    ]);
    expect(output.weightedGradePercent).toBe(78.33);
    expect(output.ungradedCount).toBe(3);
  });

  test("returns null weighted grade when nothing is graded", () => {
    const output = computeGroupGrades(
      [{ id: "g1", course_id: "c1", name: "Group", weight_percent: 100 }],
      [{ course_id: "c1", grade_group_id: "g1", graded: false, points_possible: 10, score: null }],
    );
    expect(output.groups[0]!.scorePercent).toBeNull();
    expect(output.weightedGradePercent).toBeNull();
  });
});
