/**
 * Validates the `?next=` redirect target used by `/login`.
 *
 * Accepts only a same-origin path: it must start with a single `/` (never
 * `//`, which browsers treat as protocol-relative), must contain no
 * backslash (some browsers normalize `\` to `/`, so `/\evil.example`
 * behaves like `//evil.example`), and must carry no scheme. A string that
 * starts with exactly one `/` can never be parsed as an absolute URL with a
 * scheme, so no separate scheme check is needed. Anything that fails these
 * checks falls back to `/`. A valid path's query string and fragment are
 * kept exactly as given.
 */
export const DEFAULT_NEXT_PATH = "/";

export function safeNext(next: string | null | undefined): string {
  if (!next) return DEFAULT_NEXT_PATH;
  if (!next.startsWith("/")) return DEFAULT_NEXT_PATH;
  if (next.startsWith("//")) return DEFAULT_NEXT_PATH;
  if (next.includes("\\")) return DEFAULT_NEXT_PATH;
  return next;
}
