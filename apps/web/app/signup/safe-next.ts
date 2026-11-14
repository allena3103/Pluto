const FALLBACK = "/";

/**
 * Same-origin path for post-signup redirects.
 * Keeps a single leading slash and the query string.
 * Rejects schemes, protocol-relative URLs, and backslashes.
 */
export function safeNext(value: string | null | undefined): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return FALLBACK;
  }

  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return FALLBACK;
  }

  if (value.includes("://") || /[\u0000-\u001F\u007F\s]/.test(value)) {
    return FALLBACK;
  }

  const hashIndex = value.indexOf("#");
  const withoutHash = hashIndex === -1 ? value : value.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf("?");
  const path = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);

  if (!path.startsWith("/") || path.startsWith("//") || path.includes(":") || path.includes("@")) {
    return FALLBACK;
  }

  let parsed: URL;
  try {
    parsed = new URL(value, "http://localhost");
  } catch {
    return FALLBACK;
  }

  if (parsed.origin !== "http://localhost" || parsed.username || parsed.password) {
    return FALLBACK;
  }

  if (parsed.pathname !== path) {
    return FALLBACK;
  }

  return withoutHash;
}

/** Avoid sending a signed-in visitor back to this page. */
export function signupRedirectTarget(value: string | null | undefined): string {
  const next = safeNext(value);
  const path = next.split("?")[0] ?? FALLBACK;
  if (path === "/signup" || path.startsWith("/signup/")) {
    return FALLBACK;
  }
  return next;
}
