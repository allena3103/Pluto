import { handleCalFeed } from "@/lib/cal-feed";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /cal/<token>.ics -> text/calendar with that alert's study blocks. 404 otherwise.
// Public path: the feed token is the credential. The service-role client is built
// only after the segment parses as `<token>.ics`.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleCalFeed(token, { createAdmin: createAdminClient });
}
