import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPublicSupabaseEnv, getServerEnv } from "@/lib/env";

// Allowed service-role usage: /api/ingest, /api/sms/inbound, /api/alerts/*, /api/canvas/* cron/sync, /open/:token, MCP demo-token fallback.
// TODO(orchestrator): Type this client with Database once @pluto/core/database.types exists on this branch.
export function createAdminClient() {
  const { url } = getPublicSupabaseEnv();
  const { serviceRoleKey } = getServerEnv();

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
