import { createServerClient } from "@supabase/ssr";
import type { Database } from "@pluto/core/database.types";
import { cookies } from "next/headers";
import { getPublicSupabaseEnv } from "@/lib/env";
import { supabaseFetch } from "@/lib/supabase/fetch";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getPublicSupabaseEnv();

  return createServerClient<Database>(url, anonKey, {
    global: {
      fetch: supabaseFetch,
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Ignore if this runs in a context that cannot write cookies.
        }
      },
    },
  });
}
