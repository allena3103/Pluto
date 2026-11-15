import { createServerClient } from "@supabase/ssr";
import type { Database } from "@pluto/core/database.types";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseEnv } from "@/lib/env";
import { isPublicPath } from "@/lib/public-path";
import { headersWithPlutoPath, loginRedirectForPath } from "@/lib/safe-next";
import { supabaseFetch } from "@/lib/supabase/fetch";

/** Forward the request with `x-pluto-path` overwritten from the real URL. */
function nextWithPath(request: NextRequest) {
  return NextResponse.next({
    request: {
      headers: headersWithPlutoPath(request.headers, request.nextUrl.pathname, request.nextUrl.search),
    },
  });
}

// Temporary: with PLUTO_AUTO_LOGIN_DEMO=1 every visitor without a session is signed in
// as the demo student (DEMO_STUDENT_EMAIL / DEMO_STUDENT_PASSWORD), and the login and
// signup pages send them home. Unset the flag to bring normal sign-in back.
const AUTH_PAGES = new Set(["/login", "/signup"]);

function demoCredentials(): { email: string; password: string } | null {
  if (process.env.PLUTO_AUTO_LOGIN_DEMO !== "1") return null;
  const email = process.env.DEMO_STUDENT_EMAIL;
  const password = process.env.DEMO_STUDENT_PASSWORD;
  return email && password ? { email, password } : null;
}

function redirectKeepingCookies(target: URL, response: NextResponse): NextResponse {
  const redirectResponse = NextResponse.redirect(target);
  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
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

  const { pathname } = request.nextUrl;
  const demo = demoCredentials();
  if (demo) {
    if (!user && (!isPublicPath(pathname) || AUTH_PAGES.has(pathname))) {
      // setAll above copies the new session cookies onto both the forwarded request and the response.
      const { data, error } = await supabase.auth.signInWithPassword(demo);
      if (!error) user = data.user;
    }
    if (user && AUTH_PAGES.has(pathname)) {
      return redirectKeepingCookies(new URL("/", request.url), response);
    }
  }

  if (!user && !isPublicPath(pathname)) {
    const loginUrl = new URL(loginRedirectForPath(`${pathname}${request.nextUrl.search}`), request.url);
    return redirectKeepingCookies(loginUrl, response);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
