import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@pluto/core/database.types";
import { getPublicSupabaseEnv } from "@/lib/env";
import { supabaseFetch } from "@/lib/supabase/fetch";

export function createClient() {
  const { url, anonKey } = getPublicSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey, {
    global: {
      fetch: supabaseFetch,
    },
  });
}
