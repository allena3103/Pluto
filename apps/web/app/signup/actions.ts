"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signupRedirectTarget } from "./safe-next";

const GENERIC_SIGNUP_ERROR = "Could not create the account. If you already have one, sign in.";

const NAME_REQUIRED_ERROR = "Enter your name.";

export type SignupState = {
  error: string | null;
};

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function revealsExistingAccount(error: { message: string; code?: string }): boolean {
  const code = (error.code ?? "").toLowerCase();
  const message = error.message.toLowerCase();
  return (
    code.includes("already") ||
    code.includes("exist") ||
    code.includes("registered") ||
    code.includes("duplicate") ||
    message.includes("already") ||
    message.includes("exist") ||
    message.includes("registered") ||
    message.includes("duplicate")
  );
}

function messageForAuthError(error: { message: string; code?: string }): string {
  if (revealsExistingAccount(error)) {
    return GENERIC_SIGNUP_ERROR;
  }
  const message = error.message.trim();
  if (!message || message.length > 300) {
    return GENERIC_SIGNUP_ERROR;
  }
  return message;
}

export async function signUp(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const name = field(formData, "name").trim();
  const email = field(formData, "email").trim();
  const password = field(formData, "password");
  const next = signupRedirectTarget(field(formData, "next"));

  if (!name) {
    return { error: NAME_REQUIRED_ERROR };
  }

  if (!email || !password) {
    return { error: GENERIC_SIGNUP_ERROR };
  }

  let result: Awaited<ReturnType<Awaited<ReturnType<typeof createClient>>["auth"]["signUp"]>>;
  try {
    const supabase = await createClient();
    result = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
  } catch {
    return { error: GENERIC_SIGNUP_ERROR };
  }

  if (result.error) {
    return { error: messageForAuthError(result.error) };
  }

  if (result.data.session) {
    redirect(next);
  }

  // Confirmation is off locally. A user with no session means this environment
  // is not ready to sign the student in. Do not confirm the email here.
  return { error: GENERIC_SIGNUP_ERROR };
}
