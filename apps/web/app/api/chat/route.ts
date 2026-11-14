import { llmFromEnv } from "@/lib/agent-reply";
import { handleChat } from "@/lib/chat-handler";
import { createClient } from "@/lib/supabase/server";

// POST /api/chat  { sessionId?, message }  ->  NDJSON stream of ChatStreamEvent.
// Session auth. Uses the signed-in user's client, so row-level security applies.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const db = await createClient();
  const { data, error } = await db.auth.getUser();
  const userId = !error && data.user ? data.user.id : null;

  return handleChat(request, {
    db,
    userId,
    appUrl: process.env.APP_URL,
    llm: llmFromEnv(process.env.PLUTO_LLM),
    signal: request.signal,
  });
}
