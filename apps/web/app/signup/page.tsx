import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "@/components/auth-shell";
import { signupRedirectTarget } from "./safe-next";
import { SignupForm } from "./signup-form";

function loginHref(rawNext: string | undefined, destination: string): string {
  if (rawNext === undefined) {
    return "/login";
  }
  return `/login?next=${encodeURIComponent(destination)}`;
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] | undefined }>;
}) {
  const query = await searchParams;
  const rawNext = typeof query.next === "string" ? query.next : undefined;
  const next = signupRedirectTarget(rawNext);

  let user = null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (!error) {
      user = data.user;
    }
  } catch {
    user = null;
  }

  if (user) {
    redirect(next);
  }

  return (
    <AuthShell
      title="Let's get you set up!"
      description="Name, email, and a password. That's it."
      footer={
        <>
          Already have an account?{" "}
          <a href={loginHref(rawNext, next)} className="font-extrabold text-primary underline-offset-4 hover:underline">
            Sign in
          </a>
        </>
      }
    >
      <SignupForm next={next} />
    </AuthShell>
  );
}
