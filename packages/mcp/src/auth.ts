import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@pluto/core/database.types";
import type { PlutoDb } from "@pluto/core/context";
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
  demoStudentId: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
};

export type AuthSuccess = {
  ok: true;
  studentId: string;
  db: PlutoDb;
  method: "demo";
};

export type AuthFailure = {
  ok: false;
  reason: "unauthorized";
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

function createServiceRoleClient(config: McpAuthConfig): PlutoDb {
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
 * Authenticate an MCP request. Order: demo bearer, then (later) Supabase JWT.
 * Failure is always `{ ok: false, reason: "unauthorized" }` with no token details.
 */
export function authenticate(request: Request, config: McpAuthConfig): AuthResult {
  const demo = authenticateDemo(request, config);
  if (demo) return demo;
  return { ok: false, reason: "unauthorized" };
}
