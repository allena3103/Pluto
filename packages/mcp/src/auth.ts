import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@pluto/core/database.types";
import type { PlutoDb } from "@pluto/core/context";
import { supabaseIssuer } from "./metadata";
import { supabaseFetch } from "./supabase-fetch";

/** Seed demo student. The route uses this when `PLUTO_DEMO_STUDENT_ID` is unset. */
export const DEMO_STUDENT_ID = "11111111-1111-4111-8111-111111111111";

const DEMO_TOKEN_MIN_LENGTH = 24;

export type McpAuthConfig = {
  /**
   * Demo bearer secret. The demo method is disabled unless this is set and at
   * least 24 characters. A later auth method (Supabase JWT) can run when demo
   * does not match; do not treat a bearer mismatch as final inside this file's
   * demo helper.
   */
  demoToken?: string;
  /**
   * Raw `PLUTO_DEMO_MCP_URL_ENABLED`. The URL method is on only when this is
   * exactly `"1"` and `demoToken` is enabled. Any other value leaves it off.
   */
  demoUrlFlag?: string;
  demoStudentId: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
};

export type AuthSuccess = {
  ok: true;
  studentId: string;
  db: PlutoDb;
  method: "demo" | "demo-url" | "oauth";
};

export type AuthFailure = {
  ok: false;
  reason: "unauthorized" | "not_found";
  /** True when a bearer token was sent and rejected (the 401 adds `error="invalid_token"`). */
  tokenRejected?: boolean;
};

/** Set when the request is the URL-token method. The header is not consulted. */
export type McpAuthMode = {
  urlToken: string;
};

export type AuthResult = AuthSuccess | AuthFailure;

/**
 * SHA-256 both strings, then compare the digests. Digests are fixed length, so a
 * shorter token does not throw or return early.
 */
export function digestEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function demoBearerEnabled(token: string | undefined): token is string {
  return typeof token === "string" && token.length >= DEMO_TOKEN_MIN_LENGTH;
}

/** URL fallback is on only when the flag is exactly `1` and the demo token is enabled. */
export function demoUrlActive(flag: string | undefined, token: string | undefined): token is string {
  return flag === "1" && demoBearerEnabled(token);
}

/**
 * Bearer token from the Authorization header only. Query strings and cookies are ignored.
 * Returns undefined when the header is missing or is not a Bearer credential.
 */
export function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1];
}

/**
 * Service-role client with the 10s Supabase timeout. Exported for the handler's lazy
 * `save_study_guide` text-step factory; call it only after auth succeeded.
 */
export function createServiceRoleClient(config: McpAuthConfig): PlutoDb {
  return createClient<Database>(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: supabaseFetch,
    },
  });
}

/**
 * Demo bearer check. Returns a success only after the token matches.
 * The service-role client is created only in that case.
 * Returns undefined when demo auth is disabled or the header is not the demo token,
 * so a second method can run next.
 */
export function authenticateDemo(request: Request, config: McpAuthConfig): AuthSuccess | undefined {
  if (!demoBearerEnabled(config.demoToken)) return undefined;
  const token = bearerToken(request);
  if (token === undefined) return undefined;
  if (!digestEqual(token, config.demoToken)) return undefined;
  return {
    ok: true,
    studentId: config.demoStudentId,
    db: createServiceRoleClient(config),
    method: "demo",
  };
}

/**
 * URL-token method. Checks the flag and token config before comparing, so a
 * disabled fallback never inspects the path token. Mismatch is `not_found`
 * (the handler responds 404 with no WWW-Authenticate).
 */
export function authenticateDemoUrl(urlToken: string, config: McpAuthConfig): AuthResult {
  const expected = config.demoToken;
  if (!demoUrlActive(config.demoUrlFlag, expected)) {
    return { ok: false, reason: "not_found" };
  }
  if (!digestEqual(urlToken, expected)) {
    return { ok: false, reason: "not_found" };
  }
  return {
    ok: true,
    studentId: config.demoStudentId,
    db: createServiceRoleClient(config),
    method: "demo-url",
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only these Supabase claims are read. Everything else in the token is ignored. */
type VerifiedClaims = {
  sub?: unknown;
  role?: unknown;
  exp?: unknown;
  iss?: unknown;
};

/** Anon-key client with no session storage. With `accessToken`, every request runs as that user under RLS. */
function createAnonClient(config: McpAuthConfig, accessToken?: string): PlutoDb {
  return createClient<Database>(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: supabaseFetch,
      ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
    },
  });
}

/**
 * Claim checks after the signature is verified. Exported for unit tests.
 * Returns the student id, or undefined when any check fails.
 */
export function studentIdFromClaims(claims: VerifiedClaims, config: McpAuthConfig, nowMs = Date.now()): string | undefined {
  if (typeof claims.sub !== "string" || !UUID_PATTERN.test(claims.sub)) return undefined;
  if (claims.role !== "authenticated") return undefined;
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp * 1000 <= nowMs) return undefined;
  if (claims.iss !== supabaseIssuer(config.supabaseUrl)) return undefined;
  return claims.sub;
}

/**
 * Supabase access token (from the OAuth 2.1 server or a normal sign-in).
 * `auth.getClaims` verifies the signature against the project JWKS for asymmetric
 * keys and falls back to the Auth server for HS256. Any error, a missing `sub`,
 * a role other than `authenticated` (so anon and service-role keys fail), an
 * expired token or a foreign issuer is rejected. The token is never logged.
 * The data client is anon key + the user's token: RLS applies, never the service role.
 */
export async function authenticateSupabaseJwt(token: string, config: McpAuthConfig): Promise<AuthResult> {
  const rejected: AuthFailure = { ok: false, reason: "unauthorized", tokenRejected: true };
  // A JWT is three base64url segments. Anything else is not worth a network call.
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return rejected;

  let claims: VerifiedClaims;
  try {
    const verifier = createAnonClient(config);
    const { data, error } = await verifier.auth.getClaims(token);
    if (error || !data?.claims) return rejected;
    claims = data.claims as VerifiedClaims;
  } catch {
    // Do not log the error: some auth errors quote the request.
    console.error("mcp jwt verification failed");
    return rejected;
  }

  const studentId = studentIdFromClaims(claims, config);
  if (!studentId) return rejected;

  return {
    ok: true,
    studentId,
    db: createAnonClient(config, token),
    method: "oauth",
  };
}

/**
 * Authenticate an MCP request.
 * With `mode.urlToken`, only the demo-url method runs.
 * Otherwise: demo bearer first (unchanged), then a Supabase access token.
 * Tokens are read from the Authorization header only.
 */
export async function authenticate(request: Request, config: McpAuthConfig, mode?: McpAuthMode): Promise<AuthResult> {
  if (mode) return authenticateDemoUrl(mode.urlToken, config);
  const demo = authenticateDemo(request, config);
  if (demo) return demo;
  const token = bearerToken(request);
  if (token === undefined) return { ok: false, reason: "unauthorized" };
  return authenticateSupabaseJwt(token, config);
}
