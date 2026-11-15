"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { judgeCredentials } from "@/lib/judge";
import { safeNext } from "@/lib/safe-next";

export type SignInState = {
  error: string | null;
};

const GENERIC_ERROR = "Email or password is wrong";

export async function signIn(_prevState: SignInState, formData: FormData): Promise<SignInState> {
  const email = formData.get("email");
  const password = formData.get("password");
  const next = safeNext(typeof formData.get("next") === "string" ? (formData.get("next") as string) : null);

  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return { error: GENERIC_ERROR };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Never reveal whether the email exists; one generic message for any
    // sign-in failure (wrong password, unknown email, rate limited, ...).
    return { error: GENERIC_ERROR };
  }

  redirect(next);
}

const JUDGE_ERROR = "The judge demo account is not available right now. Please try again in a minute.";

/** "Judge demo login": signs in to the shared judge account with server-held credentials. */
export async function judgeSignIn(_prevState: SignInState, formData: FormData): Promise<SignInState> {
  const next = safeNext(typeof formData.get("next") === "string" ? (formData.get("next") as string) : null);
  const credentials = judgeCredentials();
  if (!credentials) return { error: JUDGE_ERROR };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(credentials);
  if (error) {
    console.error("judge sign-in failed:", error.message);
    return { error: JUDGE_ERROR };
  }

  redirect(next);
}
