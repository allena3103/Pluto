import type { PlutoDb } from "@pluto/core/context";
import { OPEN_RESPONSE, OpenParams } from "@pluto/core/contract";
import { notePath } from "@pluto/core/deep-links";
import { consumeMagicLink, savedNotePath, type ConsumedMagicLink } from "@pluto/core/magic-links";

export type OpenDeps = {
  /** Service-role client. Only used to consume the token and read that student's email. */
  createAdmin: () => PlutoDb;
  /** Cookie-bound session client for this response (`lib/supabase/server.ts`). */
  createSession: () => Promise<PlutoDb>;
  /** Tests inject this; defaults to core `consumeMagicLink` (atomic single use). */
  consume?: (admin: PlutoDb, token: string) => Promise<ConsumedMagicLink | null>;
};

/** Relative Location: the destination never comes from the request host or query. */
function redirect(location: string): Response {
  return new Response(null, {
    status: OPEN_RESPONSE.status,
    headers: { Location: location, "Cache-Control": "no-store, private" },
  });
}

const fail = () => redirect(OPEN_RESPONSE.invalidLocation);

/**
 * GET /open/:token. Consumes a one-time magic link, signs in the student it was
 * minted for, and redirects to the exact notes page (or, for a saved-note link texted
 * after an MCP save, to `/notes/saved/<id>`). Every failure is the same
 * redirect to `/login?error=link`. Never logs the token or the email.
 */
export async function handleOpen(rawToken: unknown, deps: OpenDeps): Promise<Response> {
  const parsed = OpenParams.safeParse({ token: rawToken });
  if (!parsed.success) return fail();

  try {
    const admin = deps.createAdmin();
    const consume = deps.consume ?? consumeMagicLink;
    const link = await consume(admin, parsed.data.token);
    if (!link) return fail();

    // Everything below comes from the consumed row, never from the request.
    const { data: userData, error: userError } = await admin.auth.admin.getUserById(link.studentId);
    const email = userData?.user?.email;
    if (userError || !email || userData.user.id !== link.studentId) return fail();

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = linkData?.properties?.hashed_token;
    if (linkError || !tokenHash || linkData.user?.id !== link.studentId) return fail();

    const session = await deps.createSession();
    const { data: verified, error: verifyError } = await session.auth.verifyOtp({ type: "email", token_hash: tokenHash });
    const signedInAs = verified?.session?.user?.id ?? verified?.user?.id;
    if (verifyError || !verified?.session || signedInAs !== link.studentId) {
      await session.auth.signOut().catch(() => undefined);
      return fail();
    }

    // The destination is rebuilt from the consumed row's ids, never taken from the request.
    if (link.kind === "saved_note") return redirect(savedNotePath(link.savedNoteId));
    return redirect(notePath(link.fileId, link.page));
  } catch (err) {
    console.error("open magic link failed:", err instanceof Error ? err.name : "unknown error");
    return fail();
  }
}
