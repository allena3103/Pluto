import type { User } from "@supabase/supabase-js";

/**
 * The shared judge demo account. `npm run seed:judge` sets `app_metadata.judge`;
 * users cannot edit app_metadata, so this flag cannot be claimed by anyone else.
 * Judge accounts get no SMS (phone linking, SMS sim) and no Canvas linking, because
 * every judge shares the same account.
 */
export function isJudgeUser(user: Pick<User, "app_metadata"> | null | undefined): boolean {
  return user?.app_metadata?.judge === true;
}

/** Judge sign-in credentials, or null when the judge login button is off. Server only. */
export function judgeCredentials(): { email: string; password: string } | null {
  const email = process.env.JUDGE_STUDENT_EMAIL?.trim();
  const password = process.env.JUDGE_STUDENT_PASSWORD;
  return email && password ? { email, password } : null;
}
