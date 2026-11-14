"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loginPathForConsent, parseAuthorizationId, safeClientRedirect } from "./shared";

const FAILED_PATH = "/oauth/consent?error=failed";

type Decision = "approve" | "deny";

/**
 * Approve or deny. Server actions are reachable by direct POST, so every call
 * re-checks the session and re-reads the id from the form. Only redirects to the
 * URL Supabase returns, never to a URL taken from the request.
 */
async function decide(formData: FormData, decision: Decision): Promise<never> {
  const authorizationId = parseAuthorizationId(formData.get("authorization_id"));
  if (!authorizationId) redirect(FAILED_PATH);

  let target: string | null = null;
  let signedOut = false;
  try {
    const supabase = await createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      signedOut = true;
    } else {
      const result =
        decision === "approve"
          ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
          : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
      if (result.error) {
        console.error(`oauth consent ${decision} failed`, result.error.status ?? "", result.error.code ?? "");
      } else {
        target = safeClientRedirect(result.data?.redirect_url);
      }
    }
  } catch (error) {
    console.error(`oauth consent ${decision} failed`, error instanceof Error ? error.name : "Error");
  }

  // redirect() throws, so it stays outside the try block.
  if (signedOut) redirect(loginPathForConsent(authorizationId));
  if (!target) redirect(FAILED_PATH);
  redirect(target);
}

export async function approveConsent(formData: FormData): Promise<void> {
  await decide(formData, "approve");
}

export async function denyConsent(formData: FormData): Promise<void> {
  await decide(formData, "deny");
}
