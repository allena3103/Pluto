import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@pluto/core/database.types";
import { getPublicSupabaseEnv } from "@/lib/env";
import { getServerEnv } from "@/lib/env.server";
import { supabaseFetch } from "@/lib/supabase/fetch";

// Allowed service-role usage: /api/ingest, /api/sms/inbound, /api/alerts/*,
// /api/canvas/token (encrypted token columns; authenticated may update name only),
// /api/canvas/* cron/sync, /open/:token, MCP demo-token fallback.
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
