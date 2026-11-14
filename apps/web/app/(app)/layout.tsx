import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/app-nav";
import { PwaRegister } from "@/components/pwa-register";
import { signOut } from "./actions";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

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
    // `proxy.ts` already redirects every unauthenticated request to a
    // protected `(app)` route to `/login?next=<path+query>` before this
    // layout ever renders (App Router Layouts cannot read the request
    // pathname, only Client Components can via `usePathname()`). This check
    // is defense-in-depth for a session that expired between the proxy and
    // the render; it is not expected to fire in normal use.
    redirect("/login");
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background sm:max-w-2xl">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-base font-semibold text-foreground">Pluto</h1>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
            <LogOut className="h-4 w-4" aria-hidden />
            Sign out
          </Button>
        </form>
      </header>
      <main className="flex-1 overflow-y-auto p-4">{children}</main>
      <AppNav />
      <PwaRegister />
    </div>
  );
}
