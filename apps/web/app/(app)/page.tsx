import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  let email = "unknown";
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    email = data.user?.email ?? "unknown";
  } catch {
    email = "unknown";
  }

  return (
    <section className="space-y-2">
      <p className="text-sm text-slate-600">Signed in as</p>
      <p className="break-all text-sm font-medium text-slate-900">{email}</p>
    </section>
  );
}
