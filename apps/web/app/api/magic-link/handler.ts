import type { PlutoDb } from "@pluto/core/context";
import { INTERNAL_SECRET_HEADER, MagicLinkRequest, MagicLinkResponse } from "@pluto/core/contract";
import { createMagicLink } from "@pluto/core/magic-links";
import { secretMatches } from "../../../lib/agent-reply";
import { studentOwnsFilePage, type FilePageCheck, type MagicLinkCreator } from "../../../lib/sms-magic-link";

export type MagicLinkDeps = {
  /** `INTERNAL_API_SECRET`. Missing means the route refuses to run. */
  expectedSecret: string | undefined;
  appUrl: string | undefined;
  /** Called only after the secret matches. */
  createAdmin: () => PlutoDb;
  /** Tests inject these so they do not touch the database. */
  check?: FilePageCheck;
  create?: MagicLinkCreator;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/magic-link { studentId, fileId, page } -> { url, expiresAt }.
 * Server-to-server. The secret is checked before the body is read and before the
 * service-role client exists. "No such file" and "another student's file" are the
 * same 404.
 */
export async function handleMagicLink(request: Request, deps: MagicLinkDeps): Promise<Response> {
  if (!deps.expectedSecret || !deps.appUrl) {
    return json({ error: "Server is not configured." }, 500);
  }
  if (!secretMatches(request.headers.get(INTERNAL_SECRET_HEADER), deps.expectedSecret)) {
    return json({ error: "Unauthorized." }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }
  const parsed = MagicLinkRequest.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Body must be { studentId, fileId, page }." }, 400);
  }
  const { studentId, fileId, page } = parsed.data;

  try {
    const admin = deps.createAdmin();
    const check = deps.check ?? studentOwnsFilePage;
    if (!(await check(admin, { studentId, fileId, page }))) {
      return json({ error: "Not found." }, 404);
    }
    const create = deps.create ?? createMagicLink;
    const created = await create(admin, { studentId, fileId, page, appUrl: deps.appUrl });
    return json(MagicLinkResponse.parse({ url: created.url, expiresAt: created.expiresAt }));
  } catch (err) {
    console.error("magic link failed:", err instanceof Error ? err.message : "unknown error");
    return json({ error: "Could not create the link." }, 500);
  }
}
