/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for `/api/mcp`.
 *
 * The authorization server is Supabase Auth. Its issuer is `<SUPABASE_URL>/auth/v1`;
 * Supabase serves the matching RFC 8414 metadata at
 * `<SUPABASE_URL>/.well-known/oauth-authorization-server/auth/v1` (hosted) and
 * `<SUPABASE_URL>/auth/v1/.well-known/oauth-authorization-server` (hosted and local).
 */

export const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";
export const MCP_PATH = "/api/mcp";

export type ProtectedResourceMetadata = {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: ["header"];
  resource_name: "Pluto";
};

/** Origin or base URL with every trailing slash removed. */
export function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Supabase Auth issuer, which is also the expected `iss` claim on access tokens. */
export function supabaseIssuer(supabaseUrl: string): string {
  return `${trimTrailingSlashes(supabaseUrl)}/auth/v1`;
}

export function mcpResourceUrl(appUrl: string): string {
  return `${trimTrailingSlashes(appUrl)}${MCP_PATH}`;
}

export function resourceMetadataUrl(appUrl: string): string {
  return `${trimTrailingSlashes(appUrl)}${PROTECTED_RESOURCE_PATH}`;
}

export function buildProtectedResourceMetadata(input: {
  appUrl: string;
  supabaseUrl: string;
}): ProtectedResourceMetadata {
  return {
    resource: mcpResourceUrl(input.appUrl),
    authorization_servers: [supabaseIssuer(input.supabaseUrl)],
    bearer_methods_supported: ["header"],
    resource_name: "Pluto",
  };
}

/**
 * `WWW-Authenticate` value for a 401 from `/api/mcp`. `invalidToken` adds
 * `error="invalid_token"` when a bearer was sent but rejected (RFC 6750 section 3).
 */
export function bearerChallenge(appUrl: string, invalidToken: boolean): string {
  const metadata = `resource_metadata="${resourceMetadataUrl(appUrl)}"`;
  return invalidToken ? `Bearer error="invalid_token", ${metadata}` : `Bearer ${metadata}`;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
} as const;

/**
 * Response for `GET /.well-known/oauth-protected-resource[/api/mcp]`.
 * Missing env answers 500 with no metadata so a client never sees a wrong issuer.
 */
export function protectedResourceMetadataResponse(env: {
  appUrl: string | undefined;
  supabaseUrl: string | undefined;
}): Response {
  if (!env.appUrl || !env.supabaseUrl) {
    return Response.json(
      { error: "server_error" },
      { status: 500, headers: { "Cache-Control": "no-store", ...CORS_HEADERS } },
    );
  }
  return Response.json(buildProtectedResourceMetadata({ appUrl: env.appUrl, supabaseUrl: env.supabaseUrl }), {
    status: 200,
    headers: { "Cache-Control": "no-store", ...CORS_HEADERS },
  });
}

export function protectedResourceOptionsResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
