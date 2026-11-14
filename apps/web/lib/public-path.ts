const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/signup",
  "/open",
  "/oauth",
  "/.well-known",
  "/api",
  "/cal",
  "/auth",
  "/_next",
];

const PUBLIC_FILE_PATHS = ["/favicon.ico", "/manifest.webmanifest", "/sw.js", "/offline.html"];

// Files in `public/` are served from the site root as a single segment (`/logo.png`).
// A nested path such as `/notes/x.png` is an app route and stays behind the session guard.
const ROOT_STATIC_ASSET = /^\/[^/]+\.(?:png|jpe?g|gif|webp|svg|ico|avif|woff2?|ttf|otf|eot)$/i;

export function isPublicPath(pathname: string): boolean {
  if (pathname.includes("\\") || pathname.includes("..") || pathname.includes("\0")) {
    return false;
  }

  if (PUBLIC_FILE_PATHS.includes(pathname)) {
    return true;
  }

  // Reject still-encoded names here. proxy.ts passes nextUrl.pathname, which is decoded.
  if (!pathname.includes("%") && ROOT_STATIC_ASSET.test(pathname)) {
    return true;
  }

  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
