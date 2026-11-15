import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { handleOpen } from "./handler";

// GET /open/:token -> 302 to /notes/<fileId>?page=<n> or /notes/saved/<id> (signed in), or /login?error=link.
// Service role is used only after the token is parsed, to consume it atomically
// and to sign in the student it was minted for.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleOpen(token, { createAdmin: createAdminClient, createSession: createClient });
}
