import { createHash, randomBytes } from "node:crypto";
import type { PlutoDb } from "./context";
import { notePath } from "./deep-links";

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

export interface CreateMagicLinkInput {
  studentId: string;
  fileId: string;
  page: number;
  appUrl: string;
  now?: Date;
}

export interface CreatedMagicLink {
  url: string;
  token: string;
  expiresAt: string;
}

export interface CreateSavedNoteMagicLinkInput {
  studentId: string;
  savedNoteId: string;
  appUrl: string;
  now?: Date;
}

/** A consumed link to a file page (`kind` is optional so older callers keep working). */
export interface ConsumedFileMagicLink {
  kind?: "file";
  studentId: string;
  fileId: string;
  page: number;
  redirectPath: string;
}

/** A consumed link to a saved note (texted after an MCP `save_study_guide`). */
export interface ConsumedSavedNoteMagicLink {
  kind: "saved_note";
  studentId: string;
  savedNoteId: string;
  redirectPath: string;
}

export type ConsumedMagicLink = ConsumedFileMagicLink | ConsumedSavedNoteMagicLink;

/** `/notes/saved/<id>`: the web page for one saved note. */
export function savedNotePath(savedNoteId: string): string {
  if (!savedNoteId) throw new TypeError("savedNoteId is required");
  return `/notes/saved/${encodeURIComponent(savedNoteId)}`;
}

function assertPage(page: number): void {
  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError(`page must be an integer >= 1, got ${String(page)}`);
  }
}

function normalizeAppUrl(appUrl: string): string {
  if (!appUrl) throw new TypeError("appUrl is required");
  return appUrl.replace(/\/+$/, "");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createMagicLink(admin: PlutoDb, input: CreateMagicLinkInput): Promise<CreatedMagicLink> {
  if (!input.studentId) throw new TypeError("studentId is required");
  if (!input.fileId) throw new TypeError("fileId is required");
  assertPage(input.page);

  const appUrl = normalizeAppUrl(input.appUrl);
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + MAGIC_LINK_TTL_MS);

  const { data: file, error: fileError } = await admin
    .from("files")
    .select("id")
    .eq("student_id", input.studentId)
    .eq("id", input.fileId)
    .maybeSingle();
  if (fileError) throw new Error(`failed to verify file ownership: ${fileError.message}`);
  if (!file) throw new Error("file not found for student");

  return insertMagicLink(admin, {
    appUrl,
    expiresAt,
    row: { student_id: input.studentId, file_id: input.fileId, page: input.page },
  });
}

async function insertMagicLink(
  admin: PlutoDb,
  input: {
    appUrl: string;
    expiresAt: Date;
    row: { student_id: string; file_id?: string; page?: number; saved_note_id?: string };
  },
): Promise<CreatedMagicLink> {
  const token = randomBytes(32).toString("base64url");
  const { error } = await admin.from("magic_links").insert({
    ...input.row,
    token_hash: tokenHash(token),
    expires_at: input.expiresAt.toISOString(),
  });
  if (error) throw new Error(`failed to create magic link: ${error.message}`);

  return {
    url: `${input.appUrl}/open/${token}`,
    token,
    expiresAt: input.expiresAt.toISOString(),
  };
}

/**
 * One-time link that signs the student in and opens `/notes/saved/<id>`. Same token,
 * hashing, single use and 15-minute expiry as file links. The note must belong to
 * `studentId` (checked here and by the composite foreign key).
 */
export async function createSavedNoteMagicLink(
  admin: PlutoDb,
  input: CreateSavedNoteMagicLinkInput,
): Promise<CreatedMagicLink> {
  if (!input.studentId) throw new TypeError("studentId is required");
  if (!input.savedNoteId) throw new TypeError("savedNoteId is required");

  const appUrl = normalizeAppUrl(input.appUrl);
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + MAGIC_LINK_TTL_MS);

  const { data: note, error: noteError } = await admin
    .from("saved_notes")
    .select("id")
    .eq("student_id", input.studentId)
    .eq("id", input.savedNoteId)
    .maybeSingle();
  if (noteError) throw new Error(`failed to verify saved note ownership: ${noteError.message}`);
  if (!note) throw new Error("saved note not found for student");

  return insertMagicLink(admin, {
    appUrl,
    expiresAt,
    row: { student_id: input.studentId, saved_note_id: input.savedNoteId },
  });
}

export async function consumeMagicLink(
  admin: PlutoDb,
  token: string,
  options: { now?: Date } = {},
): Promise<ConsumedMagicLink | null> {
  if (!token) return null;
  const nowIso = (options.now ?? new Date()).toISOString();

  const { data, error } = await admin
    .from("magic_links")
    .update({ used_at: nowIso })
    .eq("token_hash", tokenHash(token))
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .select("student_id,file_id,page,saved_note_id")
    .maybeSingle();

  if (error) throw new Error(`failed to consume magic link: ${error.message}`);
  if (!data) return null;

  if (data.saved_note_id) {
    return {
      kind: "saved_note",
      studentId: data.student_id,
      savedNoteId: data.saved_note_id,
      redirectPath: savedNotePath(data.saved_note_id),
    };
  }
  if (!data.file_id) return null;

  return {
    kind: "file",
    studentId: data.student_id,
    fileId: data.file_id,
    page: data.page,
    redirectPath: notePath(data.file_id, data.page),
  };
}
