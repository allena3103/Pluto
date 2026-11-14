import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@pluto/core/database.types";
import type { PlutoDb } from "@pluto/core/context";
import { createCanvasClient, type CanvasClient } from "../../src/client";
import type { CanvasAssignment, CanvasAssignmentGroup } from "../../src/types";
import { syncCanvas, type DueDateChange, type SyncResult } from "../../src/sync";
import { dbEnv, SKIP_DB_TESTS } from "../db-env";

const TOKEN = "canvas-sync-test-token-DO-NOT-LEAK";
const DEMO_STUDENT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-14T15:00:00.000Z");

type AssignmentRow = Database["public"]["Tables"]["assignments"]["Row"];
type CourseRow = Database["public"]["Tables"]["courses"]["Row"];
type GradeGroupRow = Database["public"]["Tables"]["grade_groups"]["Row"];
type FileRow = Database["public"]["Tables"]["files"]["Row"];

function service(): PlutoDb {
  const env = dbEnv();
  return createClient<Database>(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) }),
    },
  });
}

function fixturesClient(): CanvasClient {
  return createCanvasClient({
    baseUrl: "https://fixtures.canvas.local",
    token: TOKEN,
    mode: "fixtures",
  });
}

function withEdits(
  client: CanvasClient,
  edits: {
    assignments?: (rows: CanvasAssignment[]) => CanvasAssignment[];
    groups?: (rows: CanvasAssignmentGroup[]) => CanvasAssignmentGroup[];
  },
): CanvasClient {
  return {
    listCourses: () => client.listCourses(),
    listAssignmentGroups: async (courseId) => {
      const rows = await client.listAssignmentGroups(courseId);
      return edits.groups ? edits.groups(rows) : rows;
    },
    listAssignments: async (courseId) => {
      const rows = await client.listAssignments(courseId);
      return edits.assignments ? edits.assignments(rows) : rows;
    },
    listCourseFiles: (courseId) => client.listCourseFiles(courseId),
    listModuleItems: (courseId) => client.listModuleItems(courseId),
  };
}

async function createUser(db: PlutoDb): Promise<{ id: string; email: string }> {
  const email = `canvas-sync-${randomBytes(8).toString("hex")}@pluto.test`;
  const password = `pw-${randomBytes(12).toString("hex")}`;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: "Canvas Sync" },
  });
  if (error || !data.user) throw new Error(error?.message ?? "createUser failed");
  return { id: data.user.id, email };
}

async function deleteUser(db: PlutoDb, id: string | undefined): Promise<void> {
  if (!id) return;
  const { error } = await db.auth.admin.deleteUser(id);
  if (error) console.warn(`cleanup: could not delete ${id}: ${error.message}`);
}

async function counts(db: PlutoDb, studentId: string): Promise<Record<string, number>> {
  const tables = ["courses", "grade_groups", "assignments", "files"] as const;
  const out: Record<string, number> = {};
  for (const table of tables) {
    const { count, error } = await db
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId);
    if (error) throw new Error(`${table}: ${error.message}`);
    out[table] = count ?? 0;
  }
  return out;
}

function logSync(label: string, result: SyncResult, rowCounts: Record<string, number>): void {
  console.log(
    `SYNC_COUNTS ${label} ${JSON.stringify({
      rows: rowCounts,
      courses: result.courses,
      gradeGroups: result.gradeGroups,
      assignments: result.assignments,
      files: result.files,
      dueDateChanges: result.dueDateChanges.length,
      errors: result.errors,
    })}`,
  );
}

describe.skipIf(SKIP_DB_TESTS)("syncCanvas fixtures", () => {
  let db: PlutoDb | undefined;
  const created: string[] = [];

  function database(): PlutoDb {
    db ??= service();
    return db;
  }

  afterAll(async () => {
    if (!db) return;
    for (const id of created) await deleteUser(db, id);
  });

  it("syncs one student twice, detects a due-date move, and hides the other student", async () => {
    const db = database();
    const student = await createUser(db);
    created.push(student.id);
    const base = fixturesClient();
    const calls: DueDateChange[] = [];

    const first = await syncCanvas({
      db,
      studentId: student.id,
      client: base,
      now: NOW,
      notifyDueDateChange: async (change) => {
        calls.push(change);
      },
    });
    const firstCounts = await counts(db, student.id);
    logSync("first", first, firstCounts);

    expect(JSON.stringify(first)).not.toContain(TOKEN);
    expect(first.errors).toEqual([]);
    expect(first.dueDateChanges).toEqual([]);
    expect(calls).toEqual([]);
    expect(firstCounts).toEqual({ courses: 3, grade_groups: 9, assignments: 12, files: 3 });
    expect(first.courses).toEqual({ inserted: 3, updated: 0 });
    expect(first.gradeGroups).toEqual({ inserted: 9, updated: 0 });
    expect(first.assignments).toEqual({ inserted: 12, updated: 0 });
    expect(first.files).toEqual({ inserted: 3, updated: 0 });

    for (const table of ["courses", "grade_groups", "assignments", "files"] as const) {
      const { data, error } = await db.from(table).select("student_id").eq("student_id", student.id);
      if (error) throw new Error(error.message);
      expect(data?.length).toBeGreaterThan(0);
      expect(data?.every((row) => row.student_id === student.id)).toBe(true);
    }

    const { data: lecture, error: lectureError } = await db
      .from("files")
      .select("id, storage_path, week_label, ingest_status, source, title")
      .eq("student_id", student.id)
      .eq("canvas_file_id", "hist-file-1")
      .single();
    if (lectureError) throw new Error(lectureError.message);
    expect(lecture.week_label).toBe("Week 7: Primary Sources");
    expect(lecture.ingest_status).toBe("pending");
    expect(lecture.source).toBe("canvas");
    expect(lecture.storage_path).toBe(`${student.id}/${lecture.id}.pdf`);

    const marked = await db
      .from("files")
      .update({ ingest_status: "ready", page_count: 4, ingest_error: "keep-me" })
      .eq("student_id", student.id)
      .eq("id", lecture.id);
    if (marked.error) throw new Error(marked.error.message);

    const second = await syncCanvas({
      db,
      studentId: student.id,
      client: base,
      now: NOW,
      notifyDueDateChange: async (change) => {
        calls.push(change);
      },
    });
    const secondCounts = await counts(db, student.id);
    logSync("second", second, secondCounts);
    expect(secondCounts).toEqual(firstCounts);
    expect(second.dueDateChanges).toEqual([]);
    expect(second.courses.inserted).toBe(0);
    expect(second.assignments.inserted).toBe(0);
    expect(calls).toEqual([]);

    const { data: readyFile, error: readyError } = await db
      .from("files")
      .select("ingest_status, page_count, ingest_error, storage_path")
      .eq("student_id", student.id)
      .eq("id", lecture.id)
      .single();
    if (readyError) throw new Error(readyError.message);
    expect(readyFile.ingest_status).toBe("ready");
    expect(Number(readyFile.page_count)).toBe(4);
    expect(readyFile.ingest_error).toBe("keep-me");
    expect(readyFile.storage_path).toBe(lecture.storage_path);

    const zeroWeight = await syncCanvas({
      db,
      studentId: student.id,
      client: withEdits(base, {
        groups: (rows) =>
          rows.map((row) => (row.canvasGroupId === "seed-hist-essays" ? { ...row, weightPercent: 0 } : row)),
      }),
      now: NOW,
    });
    expect(zeroWeight.dueDateChanges).toEqual([]);
    const { data: essayGroup, error: essayError } = await db
      .from("grade_groups")
      .select("weight_percent")
      .eq("student_id", student.id)
      .eq("canvas_group_id", "seed-hist-essays")
      .single();
    if (essayError) throw new Error(essayError.message);
    expect(Number(essayGroup.weight_percent)).toBe(0);

    const { data: saved, error: savedError } = await db
      .from("assignments")
      .select("id, due_at, title")
      .eq("student_id", student.id)
      .eq("canvas_assignment_id", "seed-102")
      .single();
    if (savedError || !saved.due_at) throw new Error(savedError?.message ?? "missing due date");
    const originalDue = saved.due_at;
    const movedDue = new Date(Date.parse(originalDue) + 2 * 86_400_000).toISOString();

    const moved = await syncCanvas({
      db,
      studentId: student.id,
      client: withEdits(base, {
        assignments: (rows) =>
          rows.map((row) => (row.canvasAssignmentId === "seed-102" ? { ...row, dueAt: movedDue } : row)),
      }),
      now: NOW,
      notifyDueDateChange: async (change) => {
        calls.push(change);
      },
    });
    expect(moved.dueDateChanges).toHaveLength(1);
    expect(calls).toHaveLength(1);
    const change = moved.dueDateChanges[0];
    expect(change?.assignmentId).toBe(saved.id);
    expect(change?.title).toBe(saved.title);
    expect(Date.parse(change?.oldDueAt ?? "")).toBe(Date.parse(originalDue));
    expect(Date.parse(change?.newDueAt ?? "")).toBe(Date.parse(movedDue));
    expect(calls[0]?.assignmentId).toBe(saved.id);

    const { data: changed, error: changedError } = await db
      .from("assignments")
      .select("due_at, previous_due_at, due_changed_at, title")
      .eq("student_id", student.id)
      .eq("id", saved.id)
      .single();
    if (changedError || !changed.previous_due_at || !changed.due_changed_at) {
      throw new Error(changedError?.message ?? "due change was not stored");
    }
    expect(Date.parse(changed.due_at ?? "")).toBe(Date.parse(movedDue));
    expect(Date.parse(changed.previous_due_at)).toBe(Date.parse(originalDue));
    expect(Date.parse(changed.due_changed_at)).toBe(NOW.getTime());
    const previousAfterMove = changed.previous_due_at;
    const changedAtAfterMove = changed.due_changed_at;

    const repeat = await syncCanvas({
      db,
      studentId: student.id,
      client: withEdits(base, {
        assignments: (rows) =>
          rows.map((row) => (row.canvasAssignmentId === "seed-102" ? { ...row, dueAt: movedDue } : row)),
      }),
      now: new Date("2026-11-14T18:00:00.000Z"),
      notifyDueDateChange: async (change) => {
        calls.push(change);
      },
    });
    expect(repeat.dueDateChanges).toEqual([]);
    expect(calls).toHaveLength(1);
    const { data: repeated, error: repeatedError } = await db
      .from("assignments")
      .select("previous_due_at, due_changed_at")
      .eq("student_id", student.id)
      .eq("id", saved.id)
      .single();
    if (repeatedError) throw new Error(repeatedError.message);
    expect(repeated.previous_due_at).toBe(previousAfterMove);
    expect(repeated.due_changed_at).toBe(changedAtAfterMove);

    const renamed = await syncCanvas({
      db,
      studentId: student.id,
      client: withEdits(base, {
        assignments: (rows) =>
          rows.map((row) =>
            row.canvasAssignmentId === "seed-102" ? { ...row, title: "Renamed Response", dueAt: movedDue } : row,
          ),
      }),
      now: NOW,
      notifyDueDateChange: async (change) => {
        calls.push(change);
      },
    });
    expect(renamed.dueDateChanges).toEqual([]);
    expect(calls).toHaveLength(1);
    const { data: titled, error: titledError } = await db
      .from("assignments")
      .select("title, previous_due_at, due_at")
      .eq("student_id", student.id)
      .eq("id", saved.id)
      .single();
    if (titledError) throw new Error(titledError.message);
    expect(titled.title).toBe("Renamed Response");
    expect(titled.previous_due_at).toBe(previousAfterMove);
    expect(Date.parse(titled.due_at ?? "")).toBe(Date.parse(movedDue));

    const cleared = await syncCanvas({
      db,
      studentId: student.id,
      client: withEdits(base, {
        assignments: (rows) =>
          rows.map((row) => (row.canvasAssignmentId === "seed-102" ? { ...row, dueAt: null } : row)),
      }),
      now: NOW,
      notifyDueDateChange: async (change) => {
        calls.push(change);
      },
    });
    expect(cleared.dueDateChanges).toEqual([]);
    expect(calls).toHaveLength(1);
    const { data: nulled, error: nulledError } = await db
      .from("assignments")
      .select("due_at, previous_due_at")
      .eq("student_id", student.id)
      .eq("id", saved.id)
      .single();
    if (nulledError) throw new Error(nulledError.message);
    expect(nulled.due_at).toBeNull();
    expect(nulled.previous_due_at).toBe(previousAfterMove);

    const firstTime = new Date(Date.parse(originalDue) + 5 * 86_400_000).toISOString();
    const filled = await syncCanvas({
      db,
      studentId: student.id,
      client: withEdits(base, {
        assignments: (rows) =>
          rows.map((row) => (row.canvasAssignmentId === "seed-102" ? { ...row, dueAt: firstTime } : row)),
      }),
      now: NOW,
      notifyDueDateChange: async (change) => {
        calls.push(change);
      },
    });
    expect(filled.dueDateChanges).toEqual([]);
    expect(calls).toHaveLength(1);
    const { data: filledRow, error: filledError } = await db
      .from("assignments")
      .select("due_at, previous_due_at")
      .eq("student_id", student.id)
      .eq("id", saved.id)
      .single();
    if (filledError) throw new Error(filledError.message);
    expect(Date.parse(filledRow.due_at ?? "")).toBe(Date.parse(firstTime));
    expect(filledRow.previous_due_at).toBe(previousAfterMove);

    const broken = await syncCanvas({
      db,
      studentId: student.id,
      client: withEdits(base, {
        assignments: (rows) =>
          rows.map((row) =>
            row.canvasAssignmentId === "seed-102"
              ? { ...row, dueAt: new Date(Date.parse(firstTime) + 86_400_000).toISOString() }
              : row,
          ),
      }),
      now: NOW,
      notifyDueDateChange: async () => {
        throw new Error("notifier down");
      },
    });
    expect(broken.dueDateChanges).toHaveLength(1);
    expect(broken.errors).toEqual(["Due date notification failed: notifier down"]);

    const before = {
      courses: await ownedRows(db, "courses", student.id),
      gradeGroups: await ownedRows(db, "grade_groups", student.id),
      assignments: await ownedRows(db, "assignments", student.id),
      files: await ownedRows(db, "files", student.id),
    };

    const other = await createUser(db);
    created.push(other.id);
    const otherResult = await syncCanvas({
      db,
      studentId: other.id,
      client: base,
      now: NOW,
    });
    expect(otherResult.errors).toEqual([]);
    expect(JSON.stringify(otherResult)).not.toContain(TOKEN);

    const after = {
      courses: await ownedRows(db, "courses", student.id),
      gradeGroups: await ownedRows(db, "grade_groups", student.id),
      assignments: await ownedRows(db, "assignments", student.id),
      files: await ownedRows(db, "files", student.id),
    };
    expect(after).toEqual(before);

    const otherCourses = await ownedRows(db, "courses", other.id);
    const firstCourseIds = new Set(before.courses.map((row) => row.id));
    expect(otherCourses.length).toBe(3);
    expect(otherCourses.every((row) => row.student_id === other.id && !firstCourseIds.has(row.id))).toBe(true);
    for (const table of ["grade_groups", "assignments", "files"] as const) {
      const rows = await ownedRows(db, table, other.id);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.student_id === other.id)).toBe(true);
    }
  });
});

async function ownedRows(
  db: PlutoDb,
  table: "courses" | "grade_groups" | "assignments" | "files",
  studentId: string,
): Promise<Array<{ id: string; student_id: string }>> {
  const { data, error } = await db
    .from(table)
    .select("*")
    .eq("student_id", studentId)
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

describe.skipIf(SKIP_DB_TESTS)("seeded demo student fixtures sync", () => {
  it("reports zero due-date changes and leaves previous_due_at in place", async () => {
    const db = service();
    const { data: user, error: userError } = await db.auth.admin.getUserById(DEMO_STUDENT_ID);
    if (userError || !user.user) throw new Error(userError?.message ?? "demo student is not seeded");

    const before = await demoSnapshot(db);
    try {
      const result = await syncCanvas({
        db,
        studentId: DEMO_STUDENT_ID,
        client: fixturesClient(),
        now: NOW,
        notifyDueDateChange: async () => {
          throw new Error("demo sync should not notify");
        },
      });
      const rowCounts = await counts(db, DEMO_STUDENT_ID);
      console.log(
        `DEMO_FIXTURES_SYNC ${JSON.stringify({
          courses: result.courses,
          gradeGroups: result.gradeGroups,
          assignments: result.assignments,
          files: result.files,
          dueDateChanges: result.dueDateChanges,
          errors: result.errors,
          rows: rowCounts,
        })}`,
      );
      expect(JSON.stringify(result)).not.toContain(TOKEN);
      expect(result.dueDateChanges).toEqual([]);
      expect(result.errors).toEqual([]);

      const after = await demoSnapshot(db);
      const beforeEssay = before.assignments.find((row) => row.canvas_assignment_id === "seed-101");
      const afterEssay = after.assignments.find((row) => row.canvas_assignment_id === "seed-101");
      expect(beforeEssay?.previous_due_at).toBeTruthy();
      expect(afterEssay?.previous_due_at).toBe(beforeEssay?.previous_due_at);
      expect(afterEssay?.due_changed_at).toBe(beforeEssay?.due_changed_at);
      expect(Date.parse(afterEssay?.due_at ?? "")).toBe(Date.parse(beforeEssay?.due_at ?? ""));
    } finally {
      await restoreDemo(db, before);
    }
  });
});

async function demoSnapshot(db: PlutoDb): Promise<{
  courses: CourseRow[];
  gradeGroups: GradeGroupRow[];
  assignments: AssignmentRow[];
  files: FileRow[];
}> {
  const courses = await db
    .from("courses")
    .select("*")
    .eq("student_id", DEMO_STUDENT_ID)
    .order("id", { ascending: true });
  const gradeGroups = await db
    .from("grade_groups")
    .select("*")
    .eq("student_id", DEMO_STUDENT_ID)
    .order("id", { ascending: true });
  const assignments = await db
    .from("assignments")
    .select("*")
    .eq("student_id", DEMO_STUDENT_ID)
    .order("id", { ascending: true });
  const files = await db
    .from("files")
    .select("*")
    .eq("student_id", DEMO_STUDENT_ID)
    .order("id", { ascending: true });
  if (courses.error) throw new Error(courses.error.message);
  if (gradeGroups.error) throw new Error(gradeGroups.error.message);
  if (assignments.error) throw new Error(assignments.error.message);
  if (files.error) throw new Error(files.error.message);
  return {
    courses: courses.data ?? [],
    gradeGroups: gradeGroups.data ?? [],
    assignments: assignments.data ?? [],
    files: files.data ?? [],
  };
}

async function restoreDemo(
  db: PlutoDb,
  before: {
    courses: CourseRow[];
    gradeGroups: GradeGroupRow[];
    assignments: AssignmentRow[];
    files: FileRow[];
  },
): Promise<void> {
  const after = await demoSnapshot(db);
  await deleteAdded(db, "courses", before.courses, after.courses);
  await deleteAdded(db, "assignments", before.assignments, after.assignments);
  await deleteAdded(db, "files", before.files, after.files);
  await deleteAdded(db, "grade_groups", before.gradeGroups, after.gradeGroups);

  for (const row of before.courses) {
    const { error } = await db
      .from("courses")
      .update({ name: row.name, term: row.term, canvas_course_id: row.canvas_course_id })
      .eq("student_id", DEMO_STUDENT_ID)
      .eq("id", row.id);
    if (error) throw new Error(`restore course ${row.id}: ${error.message}`);
  }
  for (const row of before.gradeGroups) {
    const { error } = await db
      .from("grade_groups")
      .update({
        course_id: row.course_id,
        name: row.name,
        weight_percent: row.weight_percent,
        canvas_group_id: row.canvas_group_id,
      })
      .eq("student_id", DEMO_STUDENT_ID)
      .eq("id", row.id);
    if (error) throw new Error(`restore group ${row.id}: ${error.message}`);
  }
  for (const row of before.assignments) {
    const { error } = await db
      .from("assignments")
      .update({
        course_id: row.course_id,
        grade_group_id: row.grade_group_id,
        title: row.title,
        due_at: row.due_at,
        previous_due_at: row.previous_due_at,
        due_changed_at: row.due_changed_at,
        points_possible: row.points_possible,
        score: row.score,
        graded: row.graded,
        submitted: row.submitted,
        canvas_assignment_id: row.canvas_assignment_id,
      })
      .eq("student_id", DEMO_STUDENT_ID)
      .eq("id", row.id);
    if (error) throw new Error(`restore assignment ${row.id}: ${error.message}`);
  }
  for (const row of before.files) {
    const { error } = await db
      .from("files")
      .update({
        course_id: row.course_id,
        title: row.title,
        week_label: row.week_label,
        added_at: row.added_at,
        source: row.source,
        storage_path: row.storage_path,
        ingest_status: row.ingest_status,
        ingest_error: row.ingest_error,
        page_count: row.page_count,
        canvas_file_id: row.canvas_file_id,
      })
      .eq("student_id", DEMO_STUDENT_ID)
      .eq("id", row.id);
    if (error) throw new Error(`restore file ${row.id}: ${error.message}`);
  }
}

async function deleteAdded(
  db: PlutoDb,
  table: "courses" | "grade_groups" | "assignments" | "files",
  before: Array<{ id: string }>,
  after: Array<{ id: string }>,
): Promise<void> {
  const kept = new Set(before.map((row) => row.id));
  for (const row of after) {
    if (kept.has(row.id)) continue;
    const { error } = await db.from(table).delete().eq("student_id", DEMO_STUDENT_ID).eq("id", row.id);
    if (error) throw new Error(`delete ${table} ${row.id}: ${error.message}`);
  }
}
