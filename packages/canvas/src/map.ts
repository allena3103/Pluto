import { randomUUID } from "node:crypto";
import type { Database } from "@pluto/core/database.types";
import type { CanvasAssignment, CanvasAssignmentGroup, CanvasCourse, CanvasCourseFile } from "./types";

type CourseInsert = Database["public"]["Tables"]["courses"]["Insert"];
type GradeGroupInsert = Database["public"]["Tables"]["grade_groups"]["Insert"];
type AssignmentInsert = Database["public"]["Tables"]["assignments"]["Insert"];
type FileInsert = Database["public"]["Tables"]["files"]["Insert"];

export type SavedAssignment = {
  id: string;
  dueAt: string | null;
  previousDueAt: string | null;
  dueChangedAt: string | null;
};

export type SavedFile = {
  id: string;
  addedAt: string;
  weekLabel: string | null;
  ingestStatus: string;
  ingestError: string | null;
  pageCount: number | null;
};

export type DueDateDecision = {
  changed: boolean;
  previousDueAt: string | null;
  dueChangedAt: string | null;
  oldDueAt: string | null;
  newDueAt: string | null;
};

const MAX_ERROR_LENGTH = 300;

export function errorText(error: unknown): string {
  const message = error instanceof Error && error.message ? error.message : "Unexpected error";
  return message.replace(/\s+/g, " ").slice(0, MAX_ERROR_LENGTH);
}

export function dedupeBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    seen.set(key(item), item);
  }
  return [...seen.values()];
}

export function countInsertedUpdated(
  ids: readonly string[],
  existingIds: ReadonlySet<string>,
): { inserted: number; updated: number } {
  let updated = 0;
  for (const id of ids) {
    if (existingIds.has(id)) updated += 1;
  }
  return { inserted: ids.length - updated, updated };
}

/** True when both strings parse and name the same millisecond. */
export function sameInstant(left: string, right: string): boolean {
  const a = Date.parse(left);
  const b = Date.parse(right);
  return !Number.isNaN(a) && !Number.isNaN(b) && a === b;
}

function offsetTimestamp(value: string): string | null {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * A due-date change is an existing row whose saved and incoming due instants
 * are both present and different. Title is not an input. A null on either side
 * keeps previous_due_at and due_changed_at as they were.
 */
export function decideDueDate(
  saved: SavedAssignment | null,
  incomingDueAt: string | null,
  now: Date,
): DueDateDecision {
  const kept: DueDateDecision = {
    changed: false,
    previousDueAt: saved?.previousDueAt ?? null,
    dueChangedAt: saved?.dueChangedAt ?? null,
    oldDueAt: null,
    newDueAt: null,
  };

  if (!saved || saved.dueAt == null || incomingDueAt == null) return kept;
  if (sameInstant(saved.dueAt, incomingDueAt)) return kept;

  const oldDueAt = offsetTimestamp(saved.dueAt);
  const newDueAt = offsetTimestamp(incomingDueAt);
  if (!oldDueAt || !newDueAt) return kept;

  return {
    changed: true,
    previousDueAt: saved.dueAt,
    dueChangedAt: now.toISOString(),
    oldDueAt,
    newDueAt,
  };
}

export function buildCourseRow(studentId: string, course: CanvasCourse): CourseInsert {
  return {
    student_id: studentId,
    canvas_course_id: course.canvasCourseId,
    name: course.name,
    term: course.term,
  };
}

export function buildGradeGroupRow(
  studentId: string,
  courseId: string,
  group: CanvasAssignmentGroup,
): GradeGroupInsert {
  return {
    student_id: studentId,
    course_id: courseId,
    canvas_group_id: group.canvasGroupId,
    name: group.name,
    weight_percent: group.weightPercent,
  };
}

export function weightIsStorable(weight: number): boolean {
  return Number.isFinite(weight) && weight >= 0 && weight <= 100;
}

export function buildAssignmentRow(input: {
  studentId: string;
  courseId: string;
  gradeGroupId: string | null;
  assignment: CanvasAssignment;
  saved: SavedAssignment | null;
  now: Date;
}): { row: AssignmentInsert; dueChange: { oldDueAt: string; newDueAt: string } | null } {
  const decision = decideDueDate(input.saved, input.assignment.dueAt, input.now);
  return {
    row: {
      student_id: input.studentId,
      course_id: input.courseId,
      grade_group_id: input.gradeGroupId,
      canvas_assignment_id: input.assignment.canvasAssignmentId,
      title: input.assignment.title,
      due_at: input.assignment.dueAt,
      points_possible: input.assignment.pointsPossible,
      score: input.assignment.score,
      graded: input.assignment.graded,
      submitted: input.assignment.submitted,
      previous_due_at: decision.previousDueAt,
      due_changed_at: decision.dueChangedAt,
    },
    dueChange:
      decision.changed && decision.oldDueAt && decision.newDueAt
        ? { oldDueAt: decision.oldDueAt, newDueAt: decision.newDueAt }
        : null,
  };
}

export function fileStoragePath(studentId: string, fileId: string): string {
  return `${studentId}/${fileId}.pdf`;
}

export function buildFileRow(input: {
  studentId: string;
  courseId: string;
  file: CanvasCourseFile;
  existing: SavedFile | null;
  weekLabel: string | null;
  now: Date;
}): FileInsert {
  const id = input.existing?.id ?? randomUUID();
  const createdAt = input.file.createdAt;
  const addedAt =
    createdAt && !Number.isNaN(Date.parse(createdAt))
      ? createdAt
      : (input.existing?.addedAt ?? input.now.toISOString());

  return {
    id,
    student_id: input.studentId,
    course_id: input.courseId,
    canvas_file_id: input.file.canvasFileId,
    title: input.file.title,
    week_label: input.weekLabel,
    added_at: addedAt,
    source: "canvas",
    storage_path: fileStoragePath(input.studentId, id),
    ingest_status: input.existing?.ingestStatus ?? "pending",
    ingest_error: input.existing?.ingestError ?? null,
    page_count: input.existing?.pageCount ?? null,
  };
}
