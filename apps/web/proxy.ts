import { createServerClient } from "@supabase/ssr";
import type { Database } from "@pluto/core/database.types";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseEnv } from "@/lib/env";
import { supabaseFetch } from "@/lib/supabase/fetch";

const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/open",
  "/oauth",
  "/.well-known",
  "/api",
  "/cal",
  "/auth",
  "/_next",
];

const PUBLIC_FILE_PATHS = ["/favicon.ico", "/manifest.webmanifest", "/sw.js"];

function isPublicPath(pathname: string) {
  if (PUBLIC_FILE_PATHS.includes(pathname)) {
    return true;
  }

  if (pathname.match(/\.(?:png|jpg|jpeg|gif|webp|svg|ico|avif|woff|woff2|ttf|otf|eot)$/i)) {
    return true;
  }

  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

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

        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });

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
    const loginUrl = new URL("/login", request.url);
    const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    loginUrl.searchParams.set("next", nextPath || "/");
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
