import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  return (
    <section className="space-y-2">
      <p className="text-sm text-slate-600">Signed in as</p>
      <p className="break-all text-sm font-medium text-slate-900">{data.user?.email ?? "unknown"}</p>
    </section>
  );
}
