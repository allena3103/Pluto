import { makeToolContext } from "@pluto/core/context";
import { createClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/env.server";

export async function createSessionToolContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null as null, ctx: null };
  }

  const ctx = makeToolContext({
    db: supabase,
    studentId: user.id,
    appUrl: getServerEnv().appUrl,
  });

  return { user, ctx };
}