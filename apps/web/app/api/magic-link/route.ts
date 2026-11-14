import { createAdminClient } from "@/lib/supabase/admin";
import { handleMagicLink } from "./handler";

// POST /api/magic-link  { studentId, fileId, page }  ->  { url, expiresAt }
// Server-to-server only: `x-internal-secret` must equal INTERNAL_API_SECRET.
// The secret is verified before the service-role client is constructed.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleMagicLink(request, {
    expectedSecret: process.env.INTERNAL_API_SECRET,
    appUrl: process.env.APP_URL,
    createAdmin: createAdminClient,
  });
}
