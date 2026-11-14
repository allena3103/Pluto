import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { encryptCanvasToken } from "@pluto/canvas/token-crypto";

export const runtime = "nodejs";
export const maxDuration = 15;

const saveTokenSchema = z.object({
  token: z.string().trim().min(20).max(200).regex(/^\S+$/, "Token must not include spaces"),
  baseUrl: z.string().trim().min(1),
});

// *.instructure.com — exactly one DNS label. The apex is not a Canvas host.
const INSTRUCTURE_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.instructure\.com$/;

type CanvasProfileUpdate = {
  canvas_token_encrypted: string | null;
  canvas_base_url: string | null;
};

function normalizeCanvasBaseUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("Base URL must be a valid URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Base URL must use https");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Base URL must be a plain host with no path, query, or fragment");
  }

  if (parsed.port !== "") {
    throw new Error("Base URL must not include a port");
  }

  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new Error("Base URL must be a plain host with no path, query, or fragment");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!INSTRUCTURE_HOST.test(hostname)) {
    throw new Error("Base URL must be an https instructure.com host");
  }

  return `https://${hostname}`;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

async function getSession() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { supabase, userId: null as string | null };
  }
  return { supabase, userId: data.user.id };
}

/**
 * Authenticated students may update profiles.name only. Token columns are
 * written with the service-role client, scoped to the session user's id.
 * Returns a response when the write fails, otherwise null.
 */
async function updateOwnCanvasProfile(
  userId: string,
  values: CanvasProfileUpdate,
  failureMessage: string,
): Promise<Response | null> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("profiles").update(values).eq("id", userId);
    if (error) return json({ error: failureMessage }, 500);
  } catch {
    return json({ error: failureMessage }, 500);
  }
  return null;
}

export async function GET(): Promise<Response> {
  const { supabase, userId } = await getSession();
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const { data, error } = await supabase
    .from("profiles")
    .select("canvas_token_encrypted,canvas_base_url")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return json({ error: "Failed to load Canvas connection" }, 500);
  }

  const connected = Boolean(data?.canvas_token_encrypted);
  const baseUrl = data?.canvas_base_url ?? null;
  return json({ connected, baseUrl });
}

export async function POST(request: Request): Promise<Response> {
  const { userId } = await getSession();
  if (!userId) return json({ error: "Unauthorized" }, 401);

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = saveTokenSchema.safeParse(rawBody);
  if (!parsed.success) {
    return json({ error: "Invalid token or base URL" }, 400);
  }

  let normalizedBaseUrl: string;
  try {
    normalizedBaseUrl = normalizeCanvasBaseUrl(parsed.data.baseUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid base URL";
    return json({ error: message }, 400);
  }

  let encryptedToken: string;
  try {
    encryptedToken = encryptCanvasToken(parsed.data.token);
  } catch {
    return json({ error: "Failed to save Canvas connection" }, 500);
  }

  const failure = await updateOwnCanvasProfile(
    userId,
    {
      canvas_token_encrypted: encryptedToken,
      canvas_base_url: normalizedBaseUrl,
    },
    "Failed to save Canvas connection",
  );
  if (failure) return failure;

  return json({ connected: true, baseUrl: normalizedBaseUrl });
}

export async function DELETE(): Promise<Response> {
  const { userId } = await getSession();
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const failure = await updateOwnCanvasProfile(
    userId,
    {
      canvas_token_encrypted: null,
      canvas_base_url: null,
    },
    "Failed to clear Canvas connection",
  );
  if (failure) return failure;

  return json({ connected: false, baseUrl: null });
}
