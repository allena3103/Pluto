import { Plug } from "lucide-react";
import { isJudgeUser } from "@/lib/judge";
import { createClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { CanvasSettingsForm } from "./settings-form";

export default async function CanvasSettingsPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id;

  let connected = false;
  let baseUrl: string | null = null;

  if (userId) {
    const { data } = await supabase
      .from("profiles")
      .select("canvas_token_encrypted,canvas_base_url")
      .eq("id", userId)
      .maybeSingle();

    connected = Boolean(data?.canvas_token_encrypted);
    baseUrl = data?.canvas_base_url ?? null;
  }

  return (
    <PageShell
      title="Canvas connection"
      description="Add your Canvas access token to sync your classes and assignments. Pluto stores this token encrypted at rest."
      icon={Plug}
      tint="lilac"
    >
      {isJudgeUser(authData.user) ? (
        <div className="rounded-3xl border border-violet-200 bg-lilac p-5">
          <p className="text-sm font-semibold text-violet-900">
            Canvas linking is off on the demo account, because every visitor shares it. The sample courses
            were loaded the same way a Canvas sync loads a student&apos;s real classes.
          </p>
        </div>
      ) : (
        <CanvasSettingsForm initialConnected={connected} initialBaseUrl={baseUrl} />
      )}
    </PageShell>
  );
}
