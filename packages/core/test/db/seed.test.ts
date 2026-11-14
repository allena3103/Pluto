// The seed matches scripts/lib/seed-ids.ts and carries the demo story (crunch week, one date change).
import { describe, expect, it } from "vitest";
import {
  COURSE_IDS,
  COURSE_NAMES,
  CRUNCH_EXAM_ASSIGNMENT_ID,
  CRUNCH_WEEK_OFFSET,
  DATE_CHANGED_ASSIGNMENT_ID,
  DEMO_STUDENT_EMAIL,
  DEMO_STUDENT_ID,
  OTHER_COURSE_ID,
  OTHER_STUDENT_EMAIL,
  OTHER_STUDENT_ID,
  SEED_COUNTS,
} from "../../../../scripts/lib/seed-ids";
import { SKIP_DB_TESTS } from "../db-env";
import { pgQuery } from "./helpers";

describe.skipIf(SKIP_DB_TESTS)("seed data", () => {
  it("has both students, confirmed, with profiles and phones", async () => {
    const rows = await pgQuery<{ id: string; email: string; confirmed: boolean; phone: string | null }>(
      `select u.id, u.email, u.email_confirmed_at is not null as confirmed, p.phone
       from auth.users u join public.profiles p on p.id = u.id where u.id = any($1::uuid[]) order by u.email`,
      [[DEMO_STUDENT_ID, OTHER_STUDENT_ID]],
    );
    expect(rows.map((r) => [r.id, r.email, r.confirmed])).toEqual([
      [DEMO_STUDENT_ID, DEMO_STUDENT_EMAIL, true],
      [OTHER_STUDENT_ID, OTHER_STUDENT_EMAIL, true],
    ]);
    expect(rows.every((r) => /^\+[1-9][0-9]{6,14}$/.test(r.phone ?? ""))).toBe(true);
  });

  it("has the seeded courses and at least the seeded row counts", async () => {
    const courses = await pgQuery<{ id: string; name: string; student_id: string }>(
      "select id, name, student_id from public.courses where id = any($1::uuid[])",
      [[...Object.values(COURSE_IDS), OTHER_COURSE_ID]],
    );
    const byId = new Map(courses.map((c) => [c.id, c]));
    for (const key of Object.keys(COURSE_IDS) as Array<keyof typeof COURSE_IDS>) {
      expect(byId.get(COURSE_IDS[key])?.name).toBe(COURSE_NAMES[key]);
      expect(byId.get(COURSE_IDS[key])?.student_id).toBe(DEMO_STUDENT_ID);
    }
    expect(byId.get(OTHER_COURSE_ID)?.student_id).toBe(OTHER_STUDENT_ID);

    for (const [who, id] of [["demo", DEMO_STUDENT_ID], ["other", OTHER_STUDENT_ID]] as const) {
      for (const table of ["courses", "grade_groups", "assignments"] as const) {
        const [row] = await pgQuery<{ n: number }>(
          `select count(*)::int as n from public.${table} where student_id = $1 and id::text ~ '^[ac6]0000000-0000-4000-8000-'`,
          [id],
        );
        expect(row?.n, `${who} ${table}`).toBe(SEED_COUNTS[who][table]);
      }
    }
  });

  it("grade group weights sum to 100 per seeded course", async () => {
    const sums = await pgQuery<{ course_id: string; total: string }>(
      "select course_id, sum(weight_percent) as total from public.grade_groups where course_id = any($1::uuid[]) and canvas_group_id like 'seed-%' group by course_id",
      [[...Object.values(COURSE_IDS), OTHER_COURSE_ID]],
    );
    expect(sums).toHaveLength(4);
    for (const s of sums) expect(Number(s.total), s.course_id).toBe(100);
  });

  it("has one clear crunch week with a heavy exam, and lighter weeks otherwise", async () => {
    const weeks = await pgQuery<{ wk: number; items: number; has_exam: boolean }>(
      `select (floor(extract(epoch from (due_at at time zone 'America/New_York')
                - date_trunc('week', now() at time zone 'America/New_York')) / 604800))::int as wk,
              count(*)::int as items,
              bool_or(id = $2 and points_possible >= 200) as has_exam
       from public.assignments
       where student_id = $1 and canvas_assignment_id like 'seed-%' and due_at > now()
       group by 1 order by 1`,
      [DEMO_STUDENT_ID, CRUNCH_EXAM_ASSIGNMENT_ID],
    );
    const crunch = weeks.find((w) => w.wk === CRUNCH_WEEK_OFFSET);
    expect(crunch?.items).toBeGreaterThanOrEqual(4);
    expect(crunch?.has_exam).toBe(true);
    for (const w of weeks.filter((x) => x.wk !== CRUNCH_WEEK_OFFSET)) expect(w.items, `week ${w.wk}`).toBeLessThanOrEqual(2);
    expect(weeks.every((w) => w.wk >= 0 && w.wk <= 8)).toBe(true);
  });

  it("has graded past work and exactly one upcoming History 105 date change", async () => {
    const [graded] = await pgQuery<{ n: number }>(
      "select count(*)::int as n from public.assignments where student_id = $1 and graded and score is not null and due_at < now()",
      [DEMO_STUDENT_ID],
    );
    expect(graded?.n).toBeGreaterThanOrEqual(10);

    const changed = await pgQuery<{ id: string; course_id: string; upcoming: boolean; moved: boolean; recent: boolean }>(
      `select id, course_id, due_at > now() as upcoming, previous_due_at <> due_at as moved,
              due_changed_at <= now() as recent
       from public.assignments
       where student_id = $1 and canvas_assignment_id like 'seed-%'
         and (previous_due_at is not null or due_changed_at is not null)`,
      [DEMO_STUDENT_ID],
    );
    expect(changed).toEqual([
      { id: DATE_CHANGED_ASSIGNMENT_ID, course_id: COURSE_IDS.history105, upcoming: true, moved: true, recent: true },
    ]);
  });

  it("seeds no files (the ingest task adds PDFs)", async () => {
    const [row] = await pgQuery<{ n: number }>(
      "select count(*)::int as n from public.files where student_id = $1 and canvas_file_id like 'seed-%'",
      [OTHER_STUDENT_ID],
    );
    expect(row?.n).toBe(0);
  });
});
