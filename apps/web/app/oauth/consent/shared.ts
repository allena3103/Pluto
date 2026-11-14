/**
 * Helpers shared by the consent page and its server actions. No secrets here.
 */

// Supabase passes an opaque id; it goes into an Auth API path, so only URL-safe characters are allowed.
const AUTHORIZATION_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function parseAuthorizationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return AUTHORIZATION_ID_PATTERN.test(value) ? value : null;
}

export function consentPath(authorizationId: string): string {
  return `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
}

export function loginPathForConsent(authorizationId: string): string {
  return `/login?next=${encodeURIComponent(consentPath(authorizationId))}`;
}

const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "vbscript:", "file:", "blob:"]);

/**
 * Accepts only a redirect URL that Supabase Auth returned (Supabase already
 * matched it against the client's registered redirect URIs). Script-capable
 * schemes are refused anyway. Returns null when the value must not be followed.
 */
export function safeClientRedirect(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (BLOCKED_SCHEMES.has(url.protocol)) return null;
  return url.toString();
}

/** Host shown to the student, or the scheme for native-app redirects. */
export function redirectHost(redirectUri: string): string {
  try {
    const url = new URL(redirectUri);
    return url.host || url.protocol;
  } catch {
    return "unknown";
  }
}

export function scopeList(scope: string): string[] {
  return scope
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
