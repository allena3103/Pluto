import { llmFromEnv } from "@/lib/agent-reply";
import { handleSmsWebhook } from "@/lib/sms-inbound";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/sms/inbound  Sendblue "receive" webhook  ->  { ok }
// The Sendblue secret header is verified (timing-safe) before the body is read and
// before the service-role client is constructed. See lib/sms-inbound.ts for the docs link.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  return handleSmsWebhook(request, {
    expectedSecret: process.env.SENDBLUE_WEBHOOK_SECRET,
    appUrl: process.env.APP_URL ?? "",
    provider: process.env.SMS_PROVIDER === "sendblue" ? "sendblue" : "simulator",
    llm: llmFromEnv(process.env.PLUTO_LLM),
    createAdmin: createAdminClient,
  });
}
