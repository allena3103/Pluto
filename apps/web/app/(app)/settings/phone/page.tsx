import { createClient } from "@/lib/supabase/server";
import { PhoneLink } from "./phone-link";

export const dynamic = "force-dynamic";

export default async function PhoneSettingsPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  let phone: string | null = null;
  let loadFailed = false;

  if (!user) {
    loadFailed = true;
  } else {
    const { data, error } = await supabase.from("profiles").select("phone").eq("id", user.id).maybeSingle();
    if (error) {
      loadFailed = true;
    } else {
      phone = data?.phone ?? null;
    }
  }

  const fromNumber = process.env.SENDBLUE_FROM_NUMBER?.trim() || null;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">Phone</h2>
      {loadFailed ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-800">We couldn&apos;t load your phone details. Please refresh and try again.</p>
        </div>
      ) : (
        <PhoneLink phone={phone} fromNumber={fromNumber} />
      )}
    </section>
  );
}
