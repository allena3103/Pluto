import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { judgeCredentials } from "@/lib/judge";
import { safeNext } from "@/lib/safe-next";
import { AuthShell } from "@/components/auth-shell";
import { DemoLogin } from "./demo-login";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next ?? null);

  let signedIn = false;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    signedIn = !error && data.user !== null;
  } catch {
    signedIn = false;
  }

  if (signedIn) {
    redirect(next);
  }

  return (
    <AuthShell
      title="Welcome back!"
      description="Sign in to Pluto, your friendly study buddy."
      banner={judgeCredentials() ? <DemoLogin next={next} /> : null}
      footer={
        <>
          New to Pluto?{" "}
          <Link
            href={next === "/" ? "/signup" : `/signup?next=${encodeURIComponent(next)}`}
            className="font-extrabold text-primary underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm next={next} expiredLink={params.error === "link"} />
    </AuthShell>
  );
}
