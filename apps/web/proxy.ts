import { createServerClient } from "@supabase/ssr";
import type { Database } from "@pluto/core/database.types";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseEnv } from "@/lib/env";
import { headersWithPlutoPath, loginRedirectForPath } from "@/lib/safe-next";
import { supabaseFetch } from "@/lib/supabase/fetch";

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

// `/offline.html` is the service worker's static fallback. It has no user
// data, so it stays public and is safe to precache while signed out.
const PUBLIC_FILE_PATHS = ["/favicon.ico", "/manifest.webmanifest", "/sw.js", "/offline.html"];

function isPublicPath(pathname: string) {
  if (PUBLIC_FILE_PATHS.includes(pathname)) {
    return true;
  }

  if (pathname.match(/\.(?:png|jpg|jpeg|gif|webp|svg|ico|avif|woff|woff2|ttf|otf|eot)$/i)) {
    return true;
  }

  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Forward the request with `x-pluto-path` overwritten from the real URL. */
function nextWithPath(request: NextRequest) {
  return NextResponse.next({
    request: {
      headers: headersWithPlutoPath(request.headers, request.nextUrl.pathname, request.nextUrl.search),
    },
  });
}

export async function proxy(request: NextRequest) {
  let response = nextWithPath(request);

  const { url, anonKey } = getPublicSupabaseEnv();
  const supabase = createServerClient<Database>(url, anonKey, {
    global: {
      fetch: supabaseFetch,
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = nextWithPath(request);

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  let user = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (!error) {
      user = data.user;
    }
  } catch {
    user = null;
  }

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const loginUrl = new URL(
      loginRedirectForPath(`${request.nextUrl.pathname}${request.nextUrl.search}`),
      request.url,
    );
    const redirectResponse = NextResponse.redirect(loginUrl);
    response.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie);
    });
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
