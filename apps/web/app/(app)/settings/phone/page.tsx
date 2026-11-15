import { redirect } from "next/navigation";
import { Smartphone } from "lucide-react";
import { isJudgeUser } from "@/lib/judge";
import { createClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { PhoneLink } from "./phone-link";

export const dynamic = "force-dynamic";

export default async function PhoneSettingsPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (isJudgeUser(user)) redirect("/");

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
    <PageShell title="Phone" description="Text Pluto from your phone, same brain as the chat." icon={Smartphone} tint="peach">
      {loadFailed ? (
        <div className="rounded-3xl border border-red-200 bg-red-50 p-5">
          <p className="text-sm font-semibold text-red-700">
            We couldn&apos;t load your phone details. Please refresh and try again.
          </p>
        </div>
      ) : (
        <PhoneLink phone={phone} fromNumber={fromNumber} />
      )}
    </PageShell>
  );
}
