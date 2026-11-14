/**
 * Validates the `?next=` redirect target used by `/login`.
 *
 * The WHATWG URL parser strips ASCII tab, newline, and carriage return before
 * it parses. A value like `/\t/evil.example` therefore survives a "starts with
 * one slash" check and is treated by the browser as the protocol-relative URL
 * `//evil.example`. Control characters are rejected first, then the remainder
 * is resolved against a fixed dummy origin. Only a result whose origin is that
 * dummy origin is accepted, and the redirect is the result's path, query, and
 * hash — never an absolute URL. Anything else falls back to `/`.
 */
export const DEFAULT_NEXT_PATH = "/";

const DUMMY_ORIGIN = "http://dummy.local";

function hasAsciiControl(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Same-origin path for `value`, or null when it must not be used as a redirect.
 * The returned string is resolved a second time so a dummy-origin URL whose
 * pathname is protocol-relative (`http://dummy.local//evil.example`) is rejected.
 */
function sameOriginPath(value: string): string | null {
  if (hasAsciiControl(value)) return null;

  let url: URL;
  try {
    url = new URL(value, DUMMY_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== DUMMY_ORIGIN) return null;

  const target = `${url.pathname}${url.search}${url.hash}`;
  if (hasAsciiControl(target) || target.includes("\\")) return null;

  let again: URL;
  try {
    again = new URL(target, DUMMY_ORIGIN);
  } catch {
    return null;
  }
  if (again.origin !== DUMMY_ORIGIN) return null;
  if (!again.pathname.startsWith("/") || again.pathname.startsWith("//")) return null;

  return target;
}

/** Percent-decoding must not reveal a control character or an off-site URL. */
function encodedFormsStaySafe(value: string): boolean {
  let current = value;
  for (let i = 0; i < 5; i++) {
    if (!current.includes("%")) return true;
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return false;
    }
    if (decoded === current) return true;
    if (sameOriginPath(decoded) === null) return false;
    current = decoded;
  }
  return !current.includes("%");
}

export function safeNext(next: string | null | undefined): string {
  if (!next) return DEFAULT_NEXT_PATH;
  // Check the raw value as well as the normalized path. A still-encoded
  // absolute URL (`https%3A%2F%2Fevil.example`) normalizes to a same-origin
  // path, but decoding the input itself yields an off-site URL.
  if (!encodedFormsStaySafe(next)) return DEFAULT_NEXT_PATH;
  const target = sameOriginPath(next);
  if (target === null) return DEFAULT_NEXT_PATH;
  if (target !== next && !encodedFormsStaySafe(target)) return DEFAULT_NEXT_PATH;
  return target;
}
