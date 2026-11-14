import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { PwaRegister } from "@/components/pwa-register";
import { SignOutButton } from "@/components/sign-out-button";
import { PLUTO_PATH_HEADER, loginRedirectForPath } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
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

  if (!user) {
    // A layout cannot read the URL. `proxy.ts` overwrites `x-pluto-path`
    // with pathname + search on the forwarded request (a client-sent value
    // does not survive). `safeNext` still rejects a hostile value if this
    // guard runs without the proxy.
    const path = (await headers()).get(PLUTO_PATH_HEADER);
    redirect(loginRedirectForPath(path));
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background sm:max-w-2xl">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-base font-semibold text-foreground">Pluto</h1>
        <SignOutButton />
      </header>
      <main className="flex-1 overflow-y-auto p-4">{children}</main>
      <AppNav />
      <PwaRegister />
    </div>
  );
}
