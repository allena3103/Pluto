import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@pluto/core/database.types";
import { getPublicSupabaseEnv, getServerEnv } from "@/lib/env";
import { supabaseFetch } from "@/lib/supabase/fetch";

// Allowed service-role usage: /api/ingest, /api/sms/inbound, /api/alerts/*, /api/canvas/* cron/sync, /open/:token, MCP demo-token fallback.
export function createAdminClient() {
  const { url } = getPublicSupabaseEnv();
  const { serviceRoleKey } = getServerEnv();

  return createClient<Database>(url, serviceRoleKey, {
    global: {
      fetch: supabaseFetch,
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
