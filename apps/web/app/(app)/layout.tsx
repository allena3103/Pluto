import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/app-nav";
import { PwaRegister } from "@/components/pwa-register";
import { SignOutButton } from "@/components/sign-out-button";

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
    // Defense in depth only. `proxy.ts` owns the `next` round trip: it
    // already redirects every unauthenticated request to a protected
    // `(app)` route to `/login?next=<path+query>` before this layout ever
    // renders (a Next 16 Layout cannot read the request path itself — only
    // a Client Component can, via `usePathname()`, and that never mounts
    // once `redirect()` has fired). This check exists only in case a
    // session expires between the proxy and this render; it should not
    // fire in normal use, and it deliberately does not attempt to
    // reconstruct `next` itself.
    redirect("/login");
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
