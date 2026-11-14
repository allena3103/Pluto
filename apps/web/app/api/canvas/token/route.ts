import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { encryptCanvasToken } from "@pluto/canvas/token-crypto";

export const runtime = "nodejs";
export const maxDuration = 15;

const saveTokenSchema = z.object({
  token: z.string().trim().min(20).max(200).regex(/^\S+$/, "Token must not include spaces"),
  baseUrl: z.string().trim().min(1),
});

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

  if (!parsed.hostname) {
    throw new Error("Base URL must include a hostname");
  }

  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error("Base URL must be a plain host with no path, query, or fragment");
  }

  return `https://${parsed.host}`;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

async function getAuthenticatedUserId() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { supabase, userId: null as string | null };
  }
  return { supabase, userId: data.user.id };
}

export async function GET(): Promise<Response> {
  const { supabase, userId } = await getAuthenticatedUserId();
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
  const { supabase, userId } = await getAuthenticatedUserId();
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

  const encryptedToken = encryptCanvasToken(parsed.data.token);
  const { error } = await supabase
    .from("profiles")
    .update({
      canvas_token_encrypted: encryptedToken,
      canvas_base_url: normalizedBaseUrl,
    })
    .eq("id", userId);

  if (error) {
    return json({ error: "Failed to save Canvas connection" }, 500);
  }

  return json({ connected: true, baseUrl: normalizedBaseUrl });
}

export async function DELETE(): Promise<Response> {
  const { supabase, userId } = await getAuthenticatedUserId();
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const { error } = await supabase
    .from("profiles")
    .update({
      canvas_token_encrypted: null,
      canvas_base_url: null,
    })
    .eq("id", userId);

  if (error) {
    return json({ error: "Failed to clear Canvas connection" }, 500);
  }

  return json({ connected: false, baseUrl: null });
}
