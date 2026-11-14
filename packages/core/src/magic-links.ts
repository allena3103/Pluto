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

export interface ConsumedMagicLink {
  studentId: string;
  fileId: string;
  page: number;
  redirectPath: string;
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

  const token = randomBytes(32).toString("base64url");
  const { error } = await admin.from("magic_links").insert({
    student_id: input.studentId,
    file_id: input.fileId,
    page: input.page,
    token_hash: tokenHash(token),
    expires_at: expiresAt.toISOString(),
  });
  if (error) throw new Error(`failed to create magic link: ${error.message}`);

  return {
    url: `${appUrl}/open/${token}`,
    token,
    expiresAt: expiresAt.toISOString(),
  };
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
    .select("student_id,file_id,page")
    .maybeSingle();

  if (error) throw new Error(`failed to consume magic link: ${error.message}`);
  if (!data) return null;

  return {
    studentId: data.student_id,
    fileId: data.file_id,
    page: data.page,
    redirectPath: notePath(data.file_id, data.page),
  };
}
