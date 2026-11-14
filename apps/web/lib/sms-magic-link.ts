import type { PlutoDb } from "@pluto/core/context";
import { createMagicLink, type CreateMagicLinkInput, type CreatedMagicLink } from "@pluto/core/magic-links";

export type MagicLinkCreator = (admin: PlutoDb, input: CreateMagicLinkInput) => Promise<CreatedMagicLink>;

export type FilePageCheck = (
  admin: PlutoDb,
  input: { studentId: string; fileId: string; page: number },
) => Promise<boolean>;

/**
 * True when `fileId` belongs to `studentId` and `page` is within its page count
 * (when the count is known). Filters by `student_id` explicitly, so the same
 * `false` covers "no such file" and "another student's file". Throws on a DB error.
 * Shared by `/api/magic-link` and the SMS reply path.
 */
export const studentOwnsFilePage: FilePageCheck = async (admin, { studentId, fileId, page }) => {
  const { data, error } = await admin
    .from("files")
    .select("id,page_count")
    .eq("student_id", studentId)
    .eq("id", fileId)
    .maybeSingle();
  if (error) throw new Error(`failed to verify file ownership: ${error.message}`);
  if (!data) return false;
  if (data.page_count !== null && page > data.page_count) return false;
  return true;
};

export type SmsMagicLinkDeps = {
  /** Service-role client. The caller has already verified the request. */
  admin: PlutoDb;
  /** From the verified request, never from the model. */
  studentId: string;
  appUrl: string;
  /** Tests inject these so they do not touch the database. */
  create?: MagicLinkCreator;
  check?: FilePageCheck;
};

/**
 * Mints a one-time `/open/<token>` URL for the first citation of an SMS reply.
 * Returns null when there is no citation, the file is not this student's, the
 * page is out of range, or the link could not be created.
 */
export async function createSmsMagicLink(
  deps: SmsMagicLinkDeps,
  citation: { fileId: string; page: number } | undefined,
): Promise<string | null> {
  if (!citation) return null;
  const create = deps.create ?? createMagicLink;
  const check = deps.check ?? studentOwnsFilePage;
  try {
    const owned = await check(deps.admin, {
      studentId: deps.studentId,
      fileId: citation.fileId,
      page: citation.page,
    });
    if (!owned) return null;
    const created = await create(deps.admin, {
      studentId: deps.studentId,
      fileId: citation.fileId,
      page: citation.page,
      appUrl: deps.appUrl,
    });
    return created.url || null;
  } catch (err) {
    console.error("sms magic link failed:", err instanceof Error ? err.message : "unknown error");
    return null;
  }
}
