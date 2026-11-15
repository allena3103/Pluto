import { randomUUID } from "node:crypto";
import type { Database } from "@pluto/core/database.types";
import type {
  CanvasAssignment,
  CanvasAssignmentGroup,
  CanvasCourse,
  CanvasCourseFile,
  CanvasFileMeta,
} from "./types";

type CourseInsert = Database["public"]["Tables"]["courses"]["Insert"];
type GradeGroupInsert = Database["public"]["Tables"]["grade_groups"]["Insert"];
type AssignmentInsert = Database["public"]["Tables"]["assignments"]["Insert"];
type FileInsert = Database["public"]["Tables"]["files"]["Insert"];
type AssignmentFileInsert = Database["public"]["Tables"]["assignment_files"]["Insert"];

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

export type SavedAssignmentFile = {
  id: string;
  assignmentId: string;
  canvasFileId: string;
  fileType: string;
  ingestStatus: string;
  canvasUpdatedAt: string | null;
  ingestAttempts: number;
};

/** `pdf` and `docx` are downloaded and read; anything else is listed by name only. */
export type AttachmentFileType = "pdf" | "docx" | "other";

export type DueDateDecision = {
  changed: boolean;
  previousDueAt: string | null;
  dueChangedAt: string | null;
  oldDueAt: string | null;
  newDueAt: string | null;
};

const MAX_ERROR_LENGTH = 300;
/** Same cap as the `assignments.description` check constraint. */
export const DESCRIPTION_MAX_CHARS = 20_000;
const ATTACHMENT_TITLE_MAX_CHARS = 300;
export const PDF_CONTENT_TYPES: Record<string, true> = { "application/pdf": true, "application/x-pdf": true };
export const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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

/** Runs `run` over `items` at most `size` at a time; results keep the input order. */
export async function mapInBatches<T, R>(
  items: readonly T[],
  size: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(...(await Promise.all(items.slice(start, start + size).map(run))));
  }
  return out;
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
      description: descriptionToText(input.assignment.descriptionHtml),
      canvas_url: httpsUrlOrNull(input.assignment.htmlUrl),
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

/** The URL when it parses and uses https, else null (same rule as `assignments.canvas_url`). */
export function httpsUrlOrNull(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Cuts to at most `max` UTF-16 units without splitting a surrogate pair (Postgres rejects a lone half). */
export function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  const end = code >= 0xd800 && code <= 0xdbff ? max - 1 : max;
  return text.slice(0, end).trimEnd();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  bull: "\u2022",
  middot: "\u00b7",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  laquo: "\u00ab",
  raquo: "\u00bb",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  deg: "\u00b0",
  times: "\u00d7",
  divide: "\u00f7",
  plusmn: "\u00b1",
  frac12: "\u00bd",
  frac14: "\u00bc",
  frac34: "\u00be",
  rarr: "\u2192",
  larr: "\u2190",
  cent: "\u00a2",
  pound: "\u00a3",
  euro: "\u20ac",
  sect: "\u00a7",
  para: "\u00b6",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (entity, body: string) => {
    if (body[0] !== "#") {
      const name = body.toLowerCase();
      return Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name]! : entity;
    }
    const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
    const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
    return valid ? String.fromCodePoint(code) : entity;
  });
}

// Tags whose content is never text; `<img>` and other void tags simply produce nothing.
const DROPPED_BLOCKS = /<(script|style|noscript|template|iframe|object|svg|head)\b[\s\S]*?(?:<\/\1\s*>|$)/gi;
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
// A tag (with its attributes captured), a text run, or a lone "<". An unquoted "<" ends a tag
// attempt, so malformed input such as "<a<a<a..." stays linear.
const HTML_TOKEN = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b((?:"[^"]*"|'[^']*'|[^'"<>])*)>|[^<]+|</g;
/** Longer descriptions are cut before parsing; the text is capped at 20,000 characters anyway. */
export const DESCRIPTION_HTML_MAX_CHARS = 200_000;
// Layout markers resolved at the end. Private-use characters, stripped from the input text first.
const LINE = "\uE000";
const PARAGRAPH = "\uE001";
const INDENT = "\uE002";
const MARKER_CHARS = /[\uE000-\uE002]/g;
const PARAGRAPH_TAGS: Record<string, true> = {
  p: true,
  div: true,
  section: true,
  article: true,
  header: true,
  footer: true,
  main: true,
  aside: true,
  nav: true,
  blockquote: true,
  pre: true,
  figure: true,
  figcaption: true,
  address: true,
  details: true,
  summary: true,
  dl: true,
  dt: true,
  dd: true,
  table: true,
  hr: true,
  h1: true,
  h2: true,
  h3: true,
  h4: true,
  h5: true,
  h6: true,
};

/**
 * Canvas description HTML as readable plain text: one blank line between paragraphs and
 * headings, list items as "- " (nested lists indented two spaces), table cells joined with
 * " | ", links reduced to their label, images/scripts/styles dropped, entities decoded,
 * whitespace collapsed. Capped at 20,000 characters. Null when nothing readable is left.
 */
export function descriptionToText(html: string | null): string | null {
  if (!html) return null;
  const source = html.slice(0, DESCRIPTION_HTML_MAX_CHARS).replace(HTML_COMMENT, "").replace(DROPPED_BLOCKS, "");
  const parts: string[] = [];
  let listDepth = 0;
  let itemStart = false;
  // Where the current item's "- " starts, while the item has no text yet.
  let markerAt = 0;
  let cellsInRow = 0;

  for (const [token, slash, rawName] of source.matchAll(HTML_TOKEN)) {
    if (!rawName) {
      // NUL never reaches Postgres text.
      let text = decodeEntities(token).replace(MARKER_CHARS, "").replaceAll("\u0000", "").replace(/\s+/g, " ");
      // Never two spaces in a row: a run of spaces would make the marker pass below quadratic.
      if (itemStart || /\s$/.test(parts.at(-1) ?? "")) text = text.trimStart();
      if (text) {
        parts.push(text);
        itemStart = false;
      }
      continue;
    }
    const name = rawName.toLowerCase();
    const closing = slash === "/";
    if (name === "br") {
      itemStart = false;
      parts.push("\n");
    } else if (name === "li") {
      itemStart = false;
      parts.push(LINE);
      if (!closing) {
        markerAt = parts.length;
        parts.push(INDENT.repeat(Math.max(0, listDepth - 1)), "- ");
        itemStart = true;
      }
    } else if (name === "ul" || name === "ol") {
      // An item that only wraps a nested list (Canvas's indent button) gets no "- " of its own.
      if (itemStart && !closing) parts.length = markerAt;
      itemStart = false;
      if (closing) listDepth = Math.max(0, listDepth - 1);
      parts.push(listDepth === 0 ? PARAGRAPH : LINE);
      if (!closing) listDepth += 1;
    } else if (name === "tr") {
      cellsInRow = 0;
      if (!itemStart) parts.push(LINE);
    } else if ((name === "td" || name === "th") && !closing) {
      if (cellsInRow > 0) parts.push(" | ");
      cellsInRow += 1;
    } else if (Object.hasOwn(PARAGRAPH_TAGS, name)) {
      if (!itemStart) parts.push(listDepth > 0 ? LINE : PARAGRAPH);
    }
  }

  const text = parts
    .join("")
    .replace(/[ \t]*[\uE000\uE001][\uE000\uE001 \t]*/g, (run) => (run.includes(PARAGRAPH) ? "\n\n" : "\n"))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    // Leading space and blank lines go before indents become spaces, so a first nested item keeps its indent.
    .replace(/^\s+/, "")
    .replaceAll(INDENT, "  ")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return text ? capText(text, DESCRIPTION_MAX_CHARS) : null;
}

const API_ENDPOINT_ATTR = /(?:^|\s)data-api-endpoint\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
const HREF_ATTR = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
// `/api/v1/courses/:cid/files/:fid`, `/courses/:cid/files/:fid[/download|/preview]`, `/files/:fid`.
const FILE_PATH = /^(?:\/api\/v1)?(?:\/courses\/([^/]+))?\/files\/(\d+(?:~\d+)?)(?:\/|$)/;

function attributeValue(attributes: string, pattern: RegExp): string | null {
  const match = pattern.exec(attributes);
  if (!match) return null;
  return decodeEntities(match[1] ?? match[2] ?? match[3] ?? "");
}

function fileIdFromLink(link: string | null, canvasCourseId: string): string | null {
  if (!link) return null;
  let pathname: string;
  try {
    pathname = new URL(link, "https://canvas.invalid").pathname;
  } catch {
    return null;
  }
  const match = FILE_PATH.exec(pathname);
  if (!match) return null;
  if (match[1] !== undefined) {
    let courseId: string;
    try {
      courseId = decodeURIComponent(match[1]);
    } catch {
      return null;
    }
    if (courseId !== canvasCourseId) return null;
  }
  return match[2] ?? null;
}

/**
 * Ids of the course files linked from a description, in order, without repeats. Only `<a>`
 * links count (an `<img>` preview is not an attachment). `data-api-endpoint` wins over `href`;
 * links into another course are ignored.
 */
export function linkedFileIds(html: string | null, canvasCourseId: string): string[] {
  if (!html) return [];
  const ids = new Set<string>();
  const source = html.slice(0, DESCRIPTION_HTML_MAX_CHARS).replace(HTML_COMMENT, "");
  for (const [, slash, name, attributes = ""] of source.matchAll(HTML_TOKEN)) {
    if (slash || name?.toLowerCase() !== "a") continue;
    const id =
      fileIdFromLink(attributeValue(attributes, API_ENDPOINT_ATTR), canvasCourseId) ??
      fileIdFromLink(attributeValue(attributes, HREF_ATTR), canvasCourseId);
    if (id) ids.add(id);
  }
  return [...ids];
}

/** pdf or docx by content type, then by file extension; everything else is `other`. */
export function classifyFileType(file: { title: string; contentType: string | null }): AttachmentFileType {
  const contentType = (file.contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (Object.hasOwn(PDF_CONTENT_TYPES, contentType)) return "pdf";
  if (contentType === DOCX_CONTENT_TYPE) return "docx";
  const name = file.title.trim().toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx")) return "docx";
  return "other";
}

/**
 * One `assignment_files` row for the upsert. Never carries the download URL. A pdf/docx row
 * keeps its saved status (`syncAssignmentFiles` moves it); `other` is always `skipped`.
 * `existing` must have the same file type: a row whose type changed is deleted first.
 */
export function buildAssignmentFileRow(input: {
  studentId: string;
  assignmentId: string;
  file: CanvasFileMeta;
  existing: SavedAssignmentFile | null;
  now: Date;
}): AssignmentFileInsert {
  const fileType = classifyFileType(input.file);
  const title = capText(input.file.title.trim(), ATTACHMENT_TITLE_MAX_CHARS) || `File ${input.file.canvasFileId}`;
  const size = input.file.sizeBytes;
  const updatedAt = input.file.updatedAt;
  return {
    student_id: input.studentId,
    assignment_id: input.assignmentId,
    canvas_file_id: input.file.canvasFileId,
    title,
    file_type: fileType,
    size_bytes: size !== null && Number.isFinite(size) && size >= 0 ? Math.round(size) : null,
    canvas_updated_at: updatedAt && !Number.isNaN(Date.parse(updatedAt)) ? updatedAt : null,
    ...attemptState(fileType, input.existing, updatedAt),
    updated_at: input.now.toISOString(),
  };
}

/**
 * Status and read attempts to write. A newer Canvas version of the file earns fresh read
 * attempts, and a failed row goes back to `pending`; a ready row stays ready (it is downloaded
 * again because its object is now older than the file).
 */
function attemptState(
  fileType: AttachmentFileType,
  existing: SavedAssignmentFile | null,
  incomingUpdatedAt: string | null,
): { ingest_status: string; ingest_attempts: number } {
  if (fileType === "other") return { ingest_status: "skipped", ingest_attempts: 0 };
  if (!existing) return { ingest_status: "pending", ingest_attempts: 0 };
  const incoming = Date.parse(incomingUpdatedAt ?? "");
  const saved = Date.parse(existing.canvasUpdatedAt ?? "");
  const newer = !Number.isNaN(incoming) && (Number.isNaN(saved) || incoming > saved);
  if (!newer) return { ingest_status: existing.ingestStatus, ingest_attempts: existing.ingestAttempts };
  return { ingest_status: existing.ingestStatus === "failed" ? "pending" : existing.ingestStatus, ingest_attempts: 0 };
}
