// Fixed ids used by supabase/seed.sql. Tests and the smoke script import these.
// Keep in sync with supabase/seed.sql (packages/core/test/db/seed.test.ts checks they match).

export const DEMO_STUDENT_ID = "11111111-1111-4111-8111-111111111111";
export const OTHER_STUDENT_ID = "22222222-2222-4222-8222-222222222222";

export const DEMO_STUDENT_EMAIL = "demo@pluto.test";
export const OTHER_STUDENT_EMAIL = "other@pluto.test";

export const DEMO_STUDENT_DEFAULT_PHONE = "+15555550100";
export const OTHER_STUDENT_DEFAULT_PHONE = "+15555550101";

export const SEED_TERM = "Fall 2026";

/** Demo student's courses. */
export const COURSE_IDS = {
  history105: "c0000000-0000-4000-8000-000000000001",
  biology151: "c0000000-0000-4000-8000-000000000002",
  statistics240: "c0000000-0000-4000-8000-000000000003",
} as const;

export const COURSE_NAMES = {
  history105: "History 105",
  biology151: "Biology 151",
  statistics240: "Statistics 240",
} as const;

/** The other student's only course (isolation tests: must never be visible to the demo student). */
export const OTHER_COURSE_ID = "c0000000-0000-4000-8000-000000000009";
export const OTHER_COURSE_NAME = "Chemistry 111";

/** The one upcoming History 105 assignment whose due date moved (date-change demo). */
export const DATE_CHANGED_ASSIGNMENT_ID = "a0000000-0000-4000-8000-000000000101";

/** The heavy exam that anchors the crunch week (3 weeks after the current week, Mon-Sun). */
export const CRUNCH_EXAM_ASSIGNMENT_ID = "a0000000-0000-4000-8000-000000000103";
export const CRUNCH_WEEK_OFFSET = 3;

/** Row counts the seed creates per student, for re-run checks. */
export const SEED_COUNTS = {
  demo: { courses: 3, grade_groups: 9, assignments: 33 },
  other: { courses: 1, grade_groups: 1, assignments: 2 },
} as const;

/** Shared judge demo account (`npm run seed:judge`, scripts/seed-judge.sql). Same synthetic data as the demo student. */
export const JUDGE_STUDENT_ID = "33333333-3333-4333-8333-333333333333";
export const JUDGE_COURSE_IDS: Record<keyof typeof COURSE_IDS, string> = {
  history105: "c0000000-0000-4000-8000-300000000001",
  biology151: "c0000000-0000-4000-8000-300000000002",
  statistics240: "c0000000-0000-4000-8000-300000000003",
};
