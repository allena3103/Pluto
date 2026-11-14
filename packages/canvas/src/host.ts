// Canvas host rules and live-mode credential selection.
// Shared by `/api/canvas/token` (when saving) and `/api/canvas/sync` (when using)
// so the two checks can't drift.

import { createCanvasClient } from "./client";
import type { CanvasClientOptions } from "./types";

/** *.instructure.com with exactly one DNS label. The apex is not a Canvas host. */
export const INSTRUCTURE_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.instructure\.com$/;

/**
 * Seeded demo student (keep in sync with `scripts/lib/seed-ids.ts` and
 * `supabase/seed.sql`; `test/sync/host.test.ts` checks they match).
 * Only this student may sync with the shared env `CANVAS_API_TOKEN`.
 */
export const DEMO_STUDENT_ID = "11111111-1111-4111-8111-111111111111";

export class CanvasBaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanvasBaseUrlError";
  }
}

/**
 * Returns `https://<host>` for a plain https *.instructure.com URL.
 * Rejects other protocols, userinfo, ports, paths, queries and fragments.
 */
export function normalizeCanvasBaseUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl.trim());
  } catch {
    throw new CanvasBaseUrlError("Base URL must be a valid URL");
  }

  if (parsed.protocol !== "https:") {
    throw new CanvasBaseUrlError("Base URL must use https");
  }
  if (parsed.username || parsed.password) {
    throw new CanvasBaseUrlError("Base URL must be a plain host with no path, query, or fragment");
  }
  if (parsed.port !== "") {
    throw new CanvasBaseUrlError("Base URL must not include a port");
  }
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new CanvasBaseUrlError("Base URL must be a plain host with no path, query, or fragment");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!INSTRUCTURE_HOST.test(hostname)) {
    throw new CanvasBaseUrlError("Base URL must be an https instructure.com host");
  }
  return `https://${hostname}`;
}

export type LiveCanvasInput = {
  studentId: string;
  profileBaseUrl: string | null | undefined;
  profileTokenCiphertext: string | null | undefined;
  envToken: string | null | undefined;
  envBaseUrl: string | null | undefined;
};

export type LiveCanvasDeps = {
  decrypt: (ciphertext: string) => string;
  createClient?: (options: CanvasClientOptions) => ReturnType<typeof createCanvasClient>;
};

export type LiveCanvasResult =
  | { ok: true; client: ReturnType<typeof createCanvasClient>; token: string; baseUrl: string }
  | { ok: false; status: 400 | 500; error: string };

/**
 * Picks live Canvas credentials as a pair, never mixed:
 * - profile token -> decrypted profile token + validated profile base URL;
 * - no profile token -> env token + env base URL, demo student only.
 * Builds the client only after every check passes, so a failure makes no request.
 */
export function prepareLiveCanvasClient(input: LiveCanvasInput, deps: LiveCanvasDeps): LiveCanvasResult {
  const build = deps.createClient ?? createCanvasClient;
  let token: string;
  let baseUrl: string;

  if (input.profileTokenCiphertext) {
    try {
      baseUrl = normalizeCanvasBaseUrl(input.profileBaseUrl ?? "");
    } catch (error) {
      const message = error instanceof CanvasBaseUrlError ? error.message : "Invalid base URL";
      return { ok: false, status: 400, error: `Saved Canvas base URL is invalid: ${message}` };
    }
    try {
      token = deps.decrypt(input.profileTokenCiphertext).trim();
    } catch {
      return { ok: false, status: 400, error: "Stored Canvas token could not be decrypted" };
    }
    if (!token) return { ok: false, status: 400, error: "Stored Canvas token could not be decrypted" };
  } else {
    if (input.studentId !== DEMO_STUDENT_ID) {
      return { ok: false, status: 400, error: "Canvas is not connected. Save a Canvas token first." };
    }
    token = input.envToken?.trim() ?? "";
    if (!token || !input.envBaseUrl?.trim()) {
      return { ok: false, status: 400, error: "Canvas is not connected. Set CANVAS_API_TOKEN and CANVAS_BASE_URL." };
    }
    try {
      baseUrl = normalizeCanvasBaseUrl(input.envBaseUrl);
    } catch {
      return { ok: false, status: 500, error: "CANVAS_BASE_URL is not a valid Canvas host" };
    }
  }

  const client = build({ baseUrl, token, mode: "live" });
  return { ok: true, client, token, baseUrl };
}
