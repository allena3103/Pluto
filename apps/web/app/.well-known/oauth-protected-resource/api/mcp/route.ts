import { protectedResourceMetadataResponse, protectedResourceOptionsResponse } from "@pluto/mcp/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RFC 9728 path-suffixed form for the resource `/api/mcp`. Public: it holds no secrets. */
export function GET(): Response {
  return protectedResourceMetadataResponse({
    appUrl: process.env.APP_URL,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
}

export function OPTIONS(): Response {
  return protectedResourceOptionsResponse();
}
