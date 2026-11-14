import { handleDeadlineChange } from "@/lib/deadline-change";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/alerts/deadline-change  { studentId, assignmentId, oldDueAt, newDueAt }  ->  AlertResponse
// Server-to-server (Canvas sync): `x-internal-secret` must equal INTERNAL_API_SECRET.
// The secret is verified (timing-safe) before the body is read and before the service-role client exists.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  return handleDeadlineChange(request, {
    expectedSecret: process.env.INTERNAL_API_SECRET,
    appUrl: process.env.APP_URL,
    provider: process.env.SMS_PROVIDER === "sendblue" ? "sendblue" : "simulator",
    createAdmin: createAdminClient,
  });
}
