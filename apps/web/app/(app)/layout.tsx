import { redirect } from "next/navigation";
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
    redirect("/login");
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-white">
      <header className="border-b border-slate-200 px-4 py-3">
        <h1 className="text-base font-semibold text-slate-900">Pluto</h1>
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
