import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppSidebar, MobileTopBar } from "@/components/app-nav";
import { PwaRegister } from "@/components/pwa-register";
import { isJudgeUser } from "@/lib/judge";
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

  const judge = isJudgeUser(user);

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <AppSidebar judge={judge} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar judge={judge} />
        <main className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto">{children}</main>
      </div>
      <PwaRegister />
    </div>
  );
}
