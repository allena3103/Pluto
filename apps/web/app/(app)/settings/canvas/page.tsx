import { Plug } from "lucide-react";
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
      <CanvasSettingsForm initialConnected={connected} initialBaseUrl={baseUrl} />
    </PageShell>
  );
}
