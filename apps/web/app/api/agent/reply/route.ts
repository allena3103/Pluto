import { handleAgentReply, llmFromEnv } from "@/lib/agent-reply";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/agent/reply  { studentId, text, channel }  ->  { text, deepLink? }
// Server-to-server only: `x-internal-secret` must equal INTERNAL_API_SECRET.
// The secret is verified before the service-role client is constructed.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  return handleAgentReply(request, {
    expectedSecret: process.env.INTERNAL_API_SECRET,
    appUrl: process.env.APP_URL,
    llm: llmFromEnv(process.env.PLUTO_LLM),
    createAdmin: createAdminClient,
  });
}
