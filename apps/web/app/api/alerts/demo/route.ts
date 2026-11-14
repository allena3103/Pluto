import { handleAlertsDemo } from "@/lib/alerts-demo";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// POST /api/alerts/demo  { studentId }  ->  AlertResponse
// Auth: a valid `x-internal-secret` (checked first, timing-safe), or the signed-in
// student whose id equals `studentId`. The service-role client is built only after that.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  return handleAlertsDemo(request, {
    expectedSecret: process.env.INTERNAL_API_SECRET,
    appUrl: process.env.APP_URL,
    provider: process.env.SMS_PROVIDER === "sendblue" ? "sendblue" : "simulator",
    getSessionUserId: async () => {
      const db = await createClient();
      const { data, error } = await db.auth.getUser();
      return !error && data.user ? data.user.id : null;
    },
    createAdmin: createAdminClient,
  });
}
