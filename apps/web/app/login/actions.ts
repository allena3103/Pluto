"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
