"use server";

import { llmFromEnv } from "@/lib/agent-reply";
import { simulateInboundSms, type SimResult } from "@/lib/sms-inbound";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * `/sms-sim` send. Checks the session first, then runs the same inbound handler
 * as the Sendblue webhook with the simulator provider. The webhook secret is
 * never involved. `fromNumber` comes from the form (so a LINK from a new test
 * number works); `simulateInboundSms` only allows 555 test numbers that are
 * unlinked or linked to this viewer.
 */
export async function sendSimMessage(fromNumber: string, content: string): Promise<SimResult> {
  if (typeof fromNumber !== "string" || typeof content !== "string") {
    return { ok: false, error: "Bad request." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { ok: false, error: "Sign in again." };

  const appUrl = process.env.APP_URL;
  if (!appUrl) return { ok: false, error: "Server is not configured." };

  try {
    return await simulateInboundSms(
      { viewerId: data.user.id, fromNumber, content },
      { createAdmin: createAdminClient, appUrl, llm: llmFromEnv(process.env.PLUTO_LLM) },
    );
  } catch (err) {
    console.error("sms sim failed:", err instanceof Error ? err.message : "unknown error");
    return { ok: false, error: "Something went wrong. Try again." };
  }
}
