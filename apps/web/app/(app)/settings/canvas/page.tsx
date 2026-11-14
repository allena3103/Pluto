import { createClient } from "@/lib/supabase/server";
import { CanvasSettingsForm } from "./settings-form";

function displayHost(baseUrl: string | null): string | null {
  if (!baseUrl) return null;
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

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

  const host = displayHost(baseUrl);

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-base font-semibold text-slate-900">Canvas connection</h2>
        <p className="text-sm text-slate-600">
          Add your Canvas access token to sync your classes and assignments. Pluto stores this token encrypted at rest.
        </p>
      </header>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-sm font-medium text-slate-900">
          {connected && host ? `Connected to ${host}` : "Not connected"}
        </p>
      </div>

      <CanvasSettingsForm initialConnected={connected} initialBaseUrl={baseUrl} />
    </section>
  );
}
