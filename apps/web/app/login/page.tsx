import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <main className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Sign in to Pluto</CardTitle>
          <CardDescription>Your AI academic manager.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm next={next} expiredLink={params.error === "link"} />
          <p className="mt-4 text-center text-sm text-muted-foreground">
            New to Pluto?{" "}
            <Link
              href={next === "/" ? "/signup" : `/signup?next=${encodeURIComponent(next)}`}
              className="font-medium text-foreground underline"
            >
              Create an account
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
