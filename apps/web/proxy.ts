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
  if (!user && !isPublicPath(pathname)) {
    const loginUrl = new URL(loginRedirectForPath(`${pathname}${request.nextUrl.search}`), request.url);
    return redirectKeepingCookies(loginUrl, response);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
