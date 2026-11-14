import type { PlutoDb } from "@pluto/core/context";
import { createMagicLink, type CreateMagicLinkInput, type CreatedMagicLink } from "@pluto/core/magic-links";

export type MagicLinkCreator = (admin: PlutoDb, input: CreateMagicLinkInput) => Promise<CreatedMagicLink>;

export type SmsMagicLinkDeps = {
  /** Service-role client. The caller has already verified the request. */
  admin: PlutoDb;
  /** From the verified request, never from the model. */
  studentId: string;
  appUrl: string;
  /** Tests inject this so they do not touch the database. */
  create?: MagicLinkCreator;
};

/**
 * Mints a one-time `/open/<token>` URL for the first citation of an SMS reply.
 * Returns null when there is no citation or the link could not be created
 * (`createMagicLink` checks that the file belongs to `studentId`).
 */
export async function createSmsMagicLink(
  deps: SmsMagicLinkDeps,
  citation: { fileId: string; page: number } | undefined,
): Promise<string | null> {
  if (!citation) return null;
  const create = deps.create ?? createMagicLink;
  try {
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
