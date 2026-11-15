import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ASSIGNMENT_FILES_BUCKET, assignmentFileStoragePath } from "@pluto/core/assignment-ingest";
import type { PlutoDb } from "@pluto/core/context";
import { FILE_LOOKUP_CONCURRENCY, type CanvasClient } from "./client";
import {
  buildAssignmentFileRow,
  buildAssignmentRow,
  buildCourseRow,
  buildFileRow,
  buildGradeGroupRow,
  classifyFileType,
  countInsertedUpdated,
  dedupeBy,
  errorText,
  fileStoragePath,
  linkedFileIds,
  mapInBatches,
  weightIsStorable,
  type SavedAssignment,
  type SavedAssignmentFile,
  type SavedFile,
} from "./map";
import {
  CanvasAuthError,
  CanvasRateLimitError,
  CanvasTimeoutError,
  type CanvasAssignment,
  type CanvasAssignmentGroup,
  type CanvasCourse,
  type CanvasCourseFile,
  type CanvasFileMeta,
  type CanvasModuleFileItem,
} from "./types";

const SYNC_BUDGET_MS = 240_000;
const DELETE_BATCH = 100;

export type DueDateChange = {
  assignmentId: string;
  courseName: string;
  title: string;
  oldDueAt: string;
  newDueAt: string;
};

export type SyncCounts = { inserted: number; updated: number };

export type SyncResult = {
  courses: SyncCounts;
  gradeGroups: SyncCounts;
  assignments: SyncCounts;
  files: SyncCounts;
  /** `assignment_files` rows: files linked from assignment descriptions. `removed`: links that are gone. */
  assignmentFiles: SyncCounts & { removed: number };
  dueDateChanges: DueDateChange[];
  errors: string[];
};

export type SyncDeps = {
  /** Service-role client. Every read and write is filtered by `studentId`. */
  db: PlutoDb;
  studentId: string;
  client: CanvasClient;
  now?: Date;
  notifyDueDateChange?: (change: DueDateChange) => Promise<void>;
};

/**
 * The course's linked files by Canvas file id. `notRead`: ids not looked up this time (lookup
 * failed for a reason other than 403/404, course cap or time budget); their saved rows are left alone.
 */
type AttachmentLookup = { files: Map<string, CanvasFileMeta>; notRead: Set<string> };

/** Linked files kept per assignment, and looked up per course per sync, so one description can't stall a sync. */
export const MAX_LINKED_FILES_PER_ASSIGNMENT = 20;
export const MAX_LINKED_FILE_LOOKUPS_PER_COURSE = 200;

type CourseWork = {
  course: CanvasCourse;
  groups: CanvasAssignmentGroup[] | null;
  assignments: CanvasAssignment[] | null;
  attachments: AttachmentLookup | null;
  files: CanvasCourseFile[] | null;
  weekByFileId: Map<string, string> | null;
};

type PendingChange = {
  assignmentId: string;
  courseName: string;
  title: string;
  oldDueAt: string;
  newDueAt: string;
};

export async function syncCanvas(deps: SyncDeps): Promise<SyncResult> {
  if (!deps.studentId) throw new TypeError("studentId is required");

  const studentId = deps.studentId;
  const now = deps.now ?? new Date();
  const started = Date.now();
  const result = emptyResult();

  const courses = await readList(result, "courses", () => deps.client.listCourses());
  if (!courses) return result;

  const work: CourseWork[] = [];
  for (const course of dedupeBy(courses, (row) => row.canvasCourseId)) {
    if (!course.canvasCourseId) continue;
    if (overBudget(started)) {
      result.errors.push("Sync stopped because it exceeded its time budget");
      break;
    }
    work.push(await loadCourse(deps.client, course, started, result));
  }

  const courseIdByCanvas = await writeCourses(deps.db, studentId, work, result);
  if (!courseIdByCanvas) return result;

  const ready = work.flatMap((item) => {
    const courseId = courseIdByCanvas.get(item.course.canvasCourseId);
    if (!courseId) return [];
    return [{ ...item, courseId }];
  });

  const groupIdByCanvas = await writeGroups(deps.db, studentId, ready, result);
  if (groupIdByCanvas) {
    const assignmentIdByCanvas = await writeAssignments(deps, studentId, ready, groupIdByCanvas, now, result);
    if (assignmentIdByCanvas) await writeAssignmentFiles(deps.db, studentId, ready, assignmentIdByCanvas, now, result);
  }
  await writeFiles(deps.db, studentId, ready, now, result);
  return result;
}

function emptyResult(): SyncResult {
  const counts = (): SyncCounts => ({ inserted: 0, updated: 0 });
  return {
    courses: counts(),
    gradeGroups: counts(),
    assignments: counts(),
    files: counts(),
    assignmentFiles: { ...counts(), removed: 0 },
    dueDateChanges: [],
    errors: [],
  };
}

function overBudget(started: number): boolean {
  return Date.now() - started > SYNC_BUDGET_MS;
}

function rethrowIfFatal(error: unknown): void {
  if (
    error instanceof CanvasAuthError ||
    error instanceof CanvasRateLimitError ||
    error instanceof CanvasTimeoutError
  ) {
    throw error;
  }
}

async function readList<T>(result: SyncResult, label: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    rethrowIfFatal(error);
    result.errors.push(`${label}: ${errorText(error)}`);
    return null;
  }
}

async function loadCourse(
  client: CanvasClient,
  course: CanvasCourse,
  started: number,
  result: SyncResult,
): Promise<CourseWork> {
  const label = course.canvasCourseId;
  const groups = await readList(result, `assignment groups ${label}`, () =>
    client.listAssignmentGroups(course.canvasCourseId),
  );
  const assignments =
    groups === null
      ? null
      : await readList(result, `assignments ${label}`, () => client.listAssignments(course.canvasCourseId));
  const attachments =
    assignments === null ? null : await loadAttachments(client, course.canvasCourseId, assignments, started, result);
  const files = await readList(result, `files ${label}`, () => client.listCourseFiles(course.canvasCourseId));
  const modules = await readList(result, `modules ${label}`, () => client.listModuleItems(course.canvasCourseId));
  return {
    course,
    groups,
    assignments,
    attachments,
    files,
    weekByFileId: modules === null ? null : weekLabels(modules),
  };
}

/**
 * Metadata of the files linked from the course's assignment descriptions, a few at a time, up to
 * the caps and only while the sync has time left. The download URL in it stays in memory; it is
 * never written anywhere. Overflow is reported once per course, without URLs.
 */
async function loadAttachments(
  client: CanvasClient,
  canvasCourseId: string,
  assignments: CanvasAssignment[],
  started: number,
  result: SyncResult,
): Promise<AttachmentLookup> {
  const lookup: AttachmentLookup = { files: new Map(), notRead: new Set() };
  const ids = new Set<string>();
  let skipped = 0;
  for (const assignment of assignments) {
    const linked = linkedFileIds(assignment.descriptionHtml, canvasCourseId);
    skipped += Math.max(0, linked.length - MAX_LINKED_FILES_PER_ASSIGNMENT);
    for (const id of linked.slice(0, MAX_LINKED_FILES_PER_ASSIGNMENT)) ids.add(id);
  }
  const all = [...ids];
  const batch = all.slice(0, MAX_LINKED_FILE_LOOKUPS_PER_COURSE);
  for (const id of all.slice(MAX_LINKED_FILE_LOOKUPS_PER_COURSE)) lookup.notRead.add(id);
  skipped += all.length - batch.length;
  if (skipped > 0) {
    result.errors.push(
      `attachments ${canvasCourseId}: ${skipped} linked files skipped (at most ${MAX_LINKED_FILES_PER_ASSIGNMENT} per assignment and ${MAX_LINKED_FILE_LOOKUPS_PER_COURSE} per course)`,
    );
  }

  let outOfTime = false;
  await mapInBatches(batch, FILE_LOOKUP_CONCURRENCY, async (fileId) => {
    if (overBudget(started)) {
      outOfTime = true;
      lookup.notRead.add(fileId);
      return;
    }
    try {
      const file = await client.getCourseFile(canvasCourseId, fileId);
      if (file) lookup.files.set(fileId, file);
    } catch (error) {
      rethrowIfFatal(error);
      lookup.notRead.add(fileId);
      result.errors.push(`attachment ${canvasCourseId}/${fileId}: ${errorText(error)}`);
    }
  });
  if (outOfTime) {
    result.errors.push(`attachments ${canvasCourseId}: stopped at the sync time budget; the rest are read next sync`);
  }
  return lookup;
}

function weekLabels(items: CanvasModuleFileItem[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const item of items) {
    if (!labels.has(item.canvasFileId)) labels.set(item.canvasFileId, item.moduleName);
  }
  return labels;
}

async function writeCourses(
  db: PlutoDb,
  studentId: string,
  work: CourseWork[],
  result: SyncResult,
): Promise<Map<string, string> | null> {
  const rows = dedupeBy(
    work.map((item) => buildCourseRow(studentId, item.course)),
    (row) => row.canvas_course_id ?? "",
  ).filter((row) => row.canvas_course_id);
  assertStudent(rows, studentId);

  const canvasIds = rows.map((row) => row.canvas_course_id).filter((id): id is string => Boolean(id));
  const existing = await loadCourseCanvasIds(db, studentId, canvasIds, result);
  if (!existing) return null;

  if (rows.length === 0) return new Map();

  const { data, error } = await db
    .from("courses")
    .upsert(rows, { onConflict: "student_id,canvas_course_id", defaultToNull: false })
    .select("id, canvas_course_id");

  if (error) {
    result.errors.push(`courses: ${errorText(error)}`);
    return null;
  }

  result.courses = countInsertedUpdated(canvasIds, existing);
  const ids = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.canvas_course_id) ids.set(row.canvas_course_id, row.id);
  }
  return ids;
}

async function writeGroups(
  db: PlutoDb,
  studentId: string,
  work: Array<CourseWork & { courseId: string }>,
  result: SyncResult,
): Promise<Map<string, string> | null> {
  const rows: Array<ReturnType<typeof buildGradeGroupRow>> = [];
  for (const item of work) {
    if (!item.groups) continue;
    for (const group of item.groups) {
      if (!group.canvasGroupId) continue;
      if (!weightIsStorable(group.weightPercent)) {
        result.errors.push(`Grade group ${group.canvasGroupId} has a weight outside 0-100`);
        continue;
      }
      rows.push(buildGradeGroupRow(studentId, item.courseId, group));
    }
  }
  const unique = dedupeBy(rows, (row) => row.canvas_group_id ?? "");
  assertStudent(unique, studentId);

  const canvasIds = unique.map((row) => row.canvas_group_id).filter((id): id is string => Boolean(id));
  const existing = await loadGroupCanvasIds(db, studentId, canvasIds, result);
  if (!existing) return null;
  if (unique.length === 0) return new Map();

  const { data, error } = await db
    .from("grade_groups")
    .upsert(unique, { onConflict: "student_id,canvas_group_id", defaultToNull: false })
    .select("id, canvas_group_id");

  if (error) {
    result.errors.push(`grade groups: ${errorText(error)}`);
    return null;
  }

  result.gradeGroups = countInsertedUpdated(canvasIds, existing);
  const ids = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.canvas_group_id) ids.set(row.canvas_group_id, row.id);
  }
  return ids;
}

/** Writes the assignments; returns their ids by Canvas id, or null when nothing could be written. */
async function writeAssignments(
  deps: SyncDeps,
  studentId: string,
  work: Array<CourseWork & { courseId: string }>,
  groupIdByCanvas: Map<string, string>,
  now: Date,
  result: SyncResult,
): Promise<Map<string, string> | null> {
  const planned: Array<{ canvasId: string; row: ReturnType<typeof buildAssignmentRow>["row"]; change: PendingChange | null }> = [];

  const canvasIds: string[] = [];
  for (const item of work) {
    if (!item.assignments) continue;
    for (const assignment of item.assignments) {
      if (assignment.canvasAssignmentId) canvasIds.push(assignment.canvasAssignmentId);
    }
  }

  const savedByCanvas = await loadAssignments(deps.db, studentId, dedupeBy(canvasIds, (id) => id), result);
  if (!savedByCanvas) return null;

  for (const item of work) {
    if (!item.assignments) continue;
    for (const assignment of dedupeBy(item.assignments, (row) => row.canvasAssignmentId)) {
      if (!assignment.canvasAssignmentId) continue;
      const saved = savedByCanvas.get(assignment.canvasAssignmentId) ?? null;
      const gradeGroupId = assignment.canvasGroupId
        ? (groupIdByCanvas.get(assignment.canvasGroupId) ?? null)
        : null;
      const built = buildAssignmentRow({
        studentId,
        courseId: item.courseId,
        gradeGroupId,
        assignment,
        saved,
        now,
      });
      const change =
        built.dueChange && saved
          ? {
              assignmentId: saved.id,
              courseName: item.course.name,
              title: assignment.title,
              oldDueAt: built.dueChange.oldDueAt,
              newDueAt: built.dueChange.newDueAt,
            }
          : null;
      planned.push({ canvasId: assignment.canvasAssignmentId, row: built.row, change });
    }
  }

  const uniquePlanned = dedupeBy(planned, (item) => item.canvasId);
  const rows = uniquePlanned.map((item) => item.row);
  assertStudent(rows, studentId);
  if (rows.length === 0) return new Map();

  const { data, error } = await deps.db
    .from("assignments")
    .upsert(rows, { onConflict: "student_id,canvas_assignment_id", defaultToNull: false })
    .select("id, canvas_assignment_id");

  if (error) {
    result.errors.push(`assignments: ${errorText(error)}`);
    return null;
  }

  const writtenIds = rows.map((row) => row.canvas_assignment_id).filter((id): id is string => Boolean(id));
  result.assignments = countInsertedUpdated(
    writtenIds,
    new Set(savedByCanvas.keys()),
  );

  const changes = uniquePlanned.flatMap((item) => (item.change ? [item.change] : []));
  result.dueDateChanges.push(...changes);

  if (deps.notifyDueDateChange) {
    for (const change of changes) {
      try {
        await deps.notifyDueDateChange(change);
      } catch (error) {
        result.errors.push(`Due date notification failed: ${errorText(error)}`);
      }
    }
  }

  const ids = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.canvas_assignment_id) ids.set(row.canvas_assignment_id, row.id);
  }
  return ids;
}

/**
 * One `assignment_files` row per file linked from each assignment's description. Rows for
 * links that are gone (or whose file now has another type) are deleted with their stored
 * object; pages go with the row. Assignments whose course could not be read are left alone.
 */
async function writeAssignmentFiles(
  db: PlutoDb,
  studentId: string,
  work: Array<CourseWork & { courseId: string }>,
  assignmentIdByCanvas: Map<string, string>,
  now: Date,
  result: SyncResult,
): Promise<void> {
  const key = (assignmentId: string, canvasFileId: string) => `${assignmentId}/${canvasFileId}`;
  const planned: Array<{ assignmentId: string; file: CanvasFileMeta }> = [];
  const kept = new Set<string>();
  const covered = new Set<string>();
  for (const item of work) {
    if (!item.assignments || !item.attachments) continue;
    for (const assignment of dedupeBy(item.assignments, (row) => row.canvasAssignmentId)) {
      const assignmentId = assignmentIdByCanvas.get(assignment.canvasAssignmentId);
      if (!assignmentId) continue;
      covered.add(assignmentId);
      const fileIds = linkedFileIds(assignment.descriptionHtml, item.course.canvasCourseId);
      // Same cap as loadAttachments: links past it are not kept.
      for (const fileId of fileIds.slice(0, MAX_LINKED_FILES_PER_ASSIGNMENT)) {
        const file = item.attachments.files.get(fileId);
        if (file) planned.push({ assignmentId, file });
        if (file || item.attachments.notRead.has(fileId)) kept.add(key(assignmentId, fileId));
      }
    }
  }

  const saved = await loadAssignmentFiles(db, studentId, result);
  if (!saved) return;
  const savedByKey = new Map(saved.map((row) => [key(row.assignmentId, row.canvasFileId), row]));
  const plannedType = new Map(planned.map(({ assignmentId, file }) => [key(assignmentId, file.canvasFileId), classifyFileType(file)]));

  const stale = saved.filter((row) => {
    if (!covered.has(row.assignmentId)) return false;
    const rowKey = key(row.assignmentId, row.canvasFileId);
    const type = plannedType.get(rowKey);
    return !kept.has(rowKey) || (type !== undefined && type !== row.fileType);
  });
  if (!(await deleteAssignmentFiles(db, studentId, stale, result))) return;
  const staleIds = new Set(stale.map((row) => row.id));

  const rows = planned.map(({ assignmentId, file }) => {
    const existing = savedByKey.get(key(assignmentId, file.canvasFileId)) ?? null;
    return buildAssignmentFileRow({
      studentId,
      assignmentId,
      file,
      existing: existing && !staleIds.has(existing.id) ? existing : null,
      now,
    });
  });
  assertStudent(rows, studentId);

  const inserted = rows.filter((row) => {
    const existing = savedByKey.get(key(row.assignment_id, row.canvas_file_id));
    return !existing || staleIds.has(existing.id);
  }).length;
  result.assignmentFiles = {
    inserted,
    updated: rows.length - inserted,
    removed: stale.filter((row) => !plannedType.has(key(row.assignmentId, row.canvasFileId))).length,
  };
  if (rows.length === 0) return;

  const { error } = await db
    .from("assignment_files")
    .upsert(rows, { onConflict: "student_id,assignment_id,canvas_file_id", defaultToNull: false });
  if (error) {
    result.errors.push(`assignment files: ${errorText(error)}`);
    result.assignmentFiles = { ...result.assignmentFiles, inserted: 0, updated: 0 };
  }
}

/** Deletes the rows (their pages cascade) and their stored objects. False when the rows could not be deleted. */
async function deleteAssignmentFiles(
  db: PlutoDb,
  studentId: string,
  rows: SavedAssignmentFile[],
  result: SyncResult,
): Promise<boolean> {
  for (let start = 0; start < rows.length; start += DELETE_BATCH) {
    const ids = rows.slice(start, start + DELETE_BATCH).map((row) => row.id);
    const { error } = await db.from("assignment_files").delete().eq("student_id", studentId).in("id", ids);
    if (error) {
      result.errors.push(`assignment files: ${errorText(error)}`);
      return false;
    }
  }
  // Paths come from the owner and row id, never from a stored value.
  const paths = rows.flatMap((row) =>
    row.fileType === "pdf" || row.fileType === "docx" ? [assignmentFileStoragePath(studentId, row.id, row.fileType)] : [],
  );
  if (paths.length > 0) {
    const { error } = await db.storage.from(ASSIGNMENT_FILES_BUCKET).remove(paths);
    if (error) result.errors.push(`assignment files storage: ${errorText(error)}`);
  }
  return true;
}

async function loadAssignmentFiles(
  db: PlutoDb,
  studentId: string,
  result: SyncResult,
): Promise<SavedAssignmentFile[] | null> {
  const pageSize = 1000;
  const found: SavedAssignmentFile[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("assignment_files")
      .select("id, assignment_id, canvas_file_id, file_type, ingest_status")
      .eq("student_id", studentId)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      result.errors.push(`assignment files: ${errorText(error)}`);
      return null;
    }
    for (const row of data ?? []) {
      found.push({
        id: row.id,
        assignmentId: row.assignment_id,
        canvasFileId: row.canvas_file_id,
        fileType: row.file_type,
        ingestStatus: row.ingest_status,
      });
    }
    if ((data ?? []).length < pageSize) return found;
  }
}

async function writeFiles(
  db: PlutoDb,
  studentId: string,
  work: Array<CourseWork & { courseId: string }>,
  now: Date,
  result: SyncResult,
): Promise<void> {
  const incoming: Array<{ item: CourseWork & { courseId: string }; file: CanvasCourseFile }> = [];
  for (const item of work) {
    if (!item.files) continue;
    for (const file of item.files) {
      if (!file.canvasFileId) continue;
      incoming.push({ item, file });
    }
  }
  const uniqueIncoming = dedupeBy(incoming, (row) => row.file.canvasFileId);
  const canvasIds = uniqueIncoming.map((row) => row.file.canvasFileId);
  const savedByCanvas = await loadFiles(db, studentId, canvasIds, result);
  if (!savedByCanvas) return;

  const rows = uniqueIncoming.map(({ item, file }) => {
    const existing = savedByCanvas.get(file.canvasFileId) ?? null;
    const weekLabel =
      item.weekByFileId === null
        ? (existing?.weekLabel ?? null)
        : (item.weekByFileId.get(file.canvasFileId) ?? null);
    return buildFileRow({
      studentId,
      courseId: item.courseId,
      file,
      existing,
      weekLabel,
      now,
    });
  });

  assertStudent(rows, studentId);
  for (const row of rows) {
    if (!row.id || row.storage_path !== fileStoragePath(studentId, row.id)) {
      throw new Error("Refusing to write a file storage path outside the student folder");
    }
  }
  if (rows.length === 0) return;

  const { error } = await db
    .from("files")
    .upsert(rows, { onConflict: "student_id,canvas_file_id", defaultToNull: false });

  if (error) {
    result.errors.push(`files: ${errorText(error)}`);
    return;
  }

  result.files = countInsertedUpdated(canvasIds, new Set(savedByCanvas.keys()));
}

const FIXTURE_JSON_HEADERS = { "content-type": "application/json" };
const FIXTURE_EASTERN = "America/New_York";
const FIXTURE_DUE_TEMPLATE = /^\{\{due:weeks=(-?\d+),days=(-?\d+)\}\}$/;

/**
 * Fixtures-mode fetch that reads `packages/canvas/fixtures` from disk.
 * The package's own loader uses `import.meta.url`, which the Next bundler
 * rewrites, so the route passes this fetch into the client instead.
 */
export function createDiskFixturesFetch(
  baseUrl: string,
  now: () => Date = () => new Date(),
): typeof fetch {
  const root = findFixturesDirectory();
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

  return async (input) => {
    const url = normalizeFixtureUrl(input, normalizedBase);
    const route = fixtureRoute(url.pathname);
    if (!route) return fixtureNotFound();

    if (route.kind === "single") {
      const body = await readFixture(root, route.filePath, now);
      return body === null ? fixtureNotFound() : jsonResponse(body);
    }

    const page = url.searchParams.get("page") ?? "1";
    const pageConfig = route.pages[page];
    if (!pageConfig) return jsonResponse("[]");

    const headers = new Headers(FIXTURE_JSON_HEADERS);
    if (pageConfig.next) {
      const nextUrl = new URL(url.toString());
      nextUrl.searchParams.set("page", pageConfig.next);
      headers.set("Link", `<${nextUrl.toString()}>; rel="next"`);
    }
    const body = await readFixture(root, pageConfig.filePath, now);
    return body === null ? fixtureNotFound() : new Response(body, { status: 200, headers });
  };
}

function findFixturesDirectory(): string {
  const candidates = [
    path.resolve(process.cwd(), "fixtures"),
    path.resolve(process.cwd(), "packages/canvas/fixtures"),
    path.resolve(process.cwd(), "../../packages/canvas/fixtures"),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "courses.json"))) return candidate;
  }
  throw new Error("Canvas fixtures directory was not found");
}

function normalizeFixtureUrl(input: URL | RequestInfo, fallbackBaseUrl: string): URL {
  if (typeof input === "string") return new URL(input, fallbackBaseUrl);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

function fixtureNotFound(): Response {
  return jsonResponse(JSON.stringify({ error: "fixture-not-found" }), 404);
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: FIXTURE_JSON_HEADERS });
}

type FixtureRoute =
  | { kind: "single"; filePath: string }
  | { kind: "paged"; pages: Record<string, { filePath: string; next?: string }> };

function fixtureRoute(pathname: string): FixtureRoute | null {
  const prefix = "/api/v1";
  if (!pathname.startsWith(prefix)) return null;
  const segments = pathname.slice(prefix.length).split("/").filter(Boolean);
  if (segments.length === 1 && segments[0] === "courses") {
    return { kind: "single", filePath: "courses.json" };
  }
  if (segments.length < 3 || segments[0] !== "courses") return null;
  const courseId = segments[1];
  const tail = segments.slice(2).join("/");
  if (!courseId) return null;
  if (tail === "assignment_groups") {
    return { kind: "single", filePath: `courses/${courseId}/assignment_groups.json` };
  }
  if (tail === "assignments") {
    return {
      kind: "paged",
      pages: {
        "1": { filePath: `courses/${courseId}/assignments.page1.json`, next: "2" },
        "2": { filePath: `courses/${courseId}/assignments.page2.json` },
      },
    };
  }
  if (tail === "files") return { kind: "single", filePath: `courses/${courseId}/files.json` };
  const fileId = /^files\/(\d+)$/.exec(tail)?.[1];
  if (fileId) return { kind: "single", filePath: `courses/${courseId}/files/${fileId}.json` };
  if (tail === "modules") return { kind: "single", filePath: `courses/${courseId}/modules-items.json` };
  return null;
}

async function readFixture(root: string, relativePath: string, now: () => Date): Promise<string | null> {
  const filePath = path.resolve(root, relativePath);
  const relative = path.relative(root, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.stringify(resolveFixtureTemplates(JSON.parse(raw) as unknown, now()));
  } catch (error) {
    if (isEnoent(error)) return null;
    throw error;
  }
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function resolveFixtureTemplates(value: unknown, now: Date): unknown {
  if (typeof value === "string") {
    const match = FIXTURE_DUE_TEMPLATE.exec(value);
    if (!match) return value;
    const weeks = Number(match[1]);
    const days = Number(match[2]);
    return resolveFixtureDue(weeks, days, now);
  }
  if (Array.isArray(value)) return value.map((item) => resolveFixtureTemplates(item, now));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = resolveFixtureTemplates(child, now);
    }
    return output;
  }
  return value;
}

function resolveFixtureDue(weeks: number, days: number, now: Date): string {
  const nowParts = easternParts(now);
  const weekday = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day)).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const monday = addCivilDays(nowParts.year, nowParts.month, nowParts.day, -daysSinceMonday);
  const target = addCivilDays(monday.year, monday.month, monday.day, weeks * 7 + days);
  return easternLocalToUtc(target.year, target.month, target.day, 23, 59, 0)
    .toISOString()
    .replace(".000Z", "Z");
}

function addCivilDays(
  year: number,
  month: number,
  day: number,
  deltaDays: number,
): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function easternLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date {
  let guessUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const desiredUtcMs = guessUtcMs;
  for (let i = 0; i < 5; i += 1) {
    const parts = easternParts(new Date(guessUtcMs));
    const observedUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const delta = desiredUtcMs - observedUtcMs;
    guessUtcMs += delta;
    if (delta === 0) break;
  }
  return new Date(guessUtcMs);
}

function easternParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: FIXTURE_EASTERN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find((item) => item.type === type);
    if (!part) throw new Error(`Missing Intl part: ${type}`);
    return Number(part.value);
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

function numericOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function assertStudent(rows: Array<{ student_id: string }>, studentId: string): void {
  for (const row of rows) {
    if (row.student_id !== studentId) {
      throw new Error("Refusing to write a row for a different student");
    }
  }
}

async function loadCourseCanvasIds(
  db: PlutoDb,
  studentId: string,
  ids: string[],
  result: SyncResult,
): Promise<Set<string> | null> {
  if (ids.length === 0) return new Set();
  const { data, error } = await db
    .from("courses")
    .select("canvas_course_id")
    .eq("student_id", studentId)
    .in("canvas_course_id", ids);
  if (error) {
    result.errors.push(`courses: ${errorText(error)}`);
    return null;
  }
  return new Set((data ?? []).flatMap((row) => (row.canvas_course_id ? [row.canvas_course_id] : [])));
}

async function loadGroupCanvasIds(
  db: PlutoDb,
  studentId: string,
  ids: string[],
  result: SyncResult,
): Promise<Set<string> | null> {
  if (ids.length === 0) return new Set();
  const { data, error } = await db
    .from("grade_groups")
    .select("canvas_group_id")
    .eq("student_id", studentId)
    .in("canvas_group_id", ids);
  if (error) {
    result.errors.push(`grade groups: ${errorText(error)}`);
    return null;
  }
  return new Set((data ?? []).flatMap((row) => (row.canvas_group_id ? [row.canvas_group_id] : [])));
}

async function loadAssignments(
  db: PlutoDb,
  studentId: string,
  ids: string[],
  result: SyncResult,
): Promise<Map<string, SavedAssignment> | null> {
  const found = new Map<string, SavedAssignment>();
  if (ids.length === 0) return found;

  const { data, error } = await db
    .from("assignments")
    .select("id, canvas_assignment_id, due_at, previous_due_at, due_changed_at")
    .eq("student_id", studentId)
    .in("canvas_assignment_id", ids);

  if (error) {
    result.errors.push(`assignments: ${errorText(error)}`);
    return null;
  }

  for (const row of data ?? []) {
    if (!row.canvas_assignment_id) continue;
    found.set(row.canvas_assignment_id, {
      id: row.id,
      dueAt: row.due_at,
      previousDueAt: row.previous_due_at,
      dueChangedAt: row.due_changed_at,
    });
  }
  return found;
}

async function loadFiles(
  db: PlutoDb,
  studentId: string,
  ids: string[],
  result: SyncResult,
): Promise<Map<string, SavedFile> | null> {
  const found = new Map<string, SavedFile>();
  if (ids.length === 0) return found;

  const { data, error } = await db
    .from("files")
    .select("id, canvas_file_id, added_at, week_label, ingest_status, ingest_error, page_count")
    .eq("student_id", studentId)
    .in("canvas_file_id", ids);

  if (error) {
    result.errors.push(`files: ${errorText(error)}`);
    return null;
  }

  for (const row of data ?? []) {
    if (!row.canvas_file_id) continue;
    found.set(row.canvas_file_id, {
      id: row.id,
      addedAt: row.added_at,
      weekLabel: row.week_label,
      ingestStatus: row.ingest_status,
      ingestError: row.ingest_error,
      pageCount: numericOrNull(row.page_count),
    });
  }
  return found;
}
