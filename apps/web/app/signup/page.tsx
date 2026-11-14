import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-white">
      <header className="border-b border-slate-200 px-4 py-3">
        <p className="text-base font-semibold text-slate-900">Pluto</p>
      </header>
      <main className="flex-1 p-4">
        <h1 className="text-lg font-semibold text-slate-900">Create an account</h1>
        <p className="mt-1 text-sm text-slate-600">Name, email, and a password.</p>
        <SignupForm next={next} />
        <p className="mt-4 text-sm text-slate-600">
          Already have an account?{" "}
          <a href={loginHref(rawNext, next)} className="font-medium text-slate-900 underline">
            Sign in
          </a>
        </p>
      </main>
    </div>
  );
}
