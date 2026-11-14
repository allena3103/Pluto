import { readFile } from "node:fs/promises";

const API_PREFIX = "/api/v1";
const JSON_HEADERS = { "Content-Type": "application/json" };

type FixturePage = {
  filePath: string;
  next?: string;
};

type FixtureRoute =
  | { kind: "single"; filePath: string }
  | { kind: "paged"; pages: Record<string, FixturePage> };

export function createFixturesFetch(baseUrl: string): typeof fetch {
  const normalizedBase = trimTrailingSlash(baseUrl);

  return async (input, _init) => {
    const url = normalizeUrl(input, normalizedBase);
    const route = resolveFixtureRoute(url);
    if (!route) {
      return new Response(JSON.stringify({ error: "fixture-not-found" }), {
        status: 404,
        headers: JSON_HEADERS,
      });
    }

    if (route.kind === "single") {
      const body = await loadFixtureJson(route.filePath);
      return new Response(body, { status: 200, headers: JSON_HEADERS });
    }

    const page = url.searchParams.get("page") ?? "1";
    const pageConfig = route.pages[page];
    if (!pageConfig) {
      return new Response(JSON.stringify([]), { status: 200, headers: JSON_HEADERS });
    }

    const headers = new Headers(JSON_HEADERS);
    if (pageConfig.next) {
      const nextUrl = new URL(url.toString());
      nextUrl.searchParams.set("page", pageConfig.next);
      headers.set("Link", `<${nextUrl.toString()}>; rel="next"`);
    }

    const body = await loadFixtureJson(pageConfig.filePath);
    return new Response(body, { status: 200, headers });
  };
}

function normalizeUrl(input: URL | RequestInfo, fallbackBaseUrl: string): URL {
  if (typeof input === "string") {
    return new URL(input, fallbackBaseUrl);
  }
  if (input instanceof URL) {
    return input;
  }
  return new URL(input.url);
}

function resolveFixtureRoute(url: URL): FixtureRoute | null {
  const path = url.pathname;
  if (!path.startsWith(API_PREFIX)) {
    return null;
  }

  const segments = path.slice(API_PREFIX.length).split("/").filter(Boolean);
  if (segments.length === 1 && segments[0] === "courses") {
    return { kind: "single", filePath: "courses.json" };
  }

  if (segments.length < 3 || segments[0] !== "courses") {
    return null;
  }

  const courseId = segments[1];
  const tail = segments.slice(2).join("/");

  if (tail === "assignment_groups") {
    return { kind: "single", filePath: `courses/${courseId}/assignment_groups.json` };
  }

  if (tail === "assignments") {
    return {
      kind: "paged",
      pages: {
        "1": { filePath: `courses/${courseId}/assignments.page1.json`, next: "2" },
        "2": { filePath: `courses/${courseId}/assignments.page2.json` },
      },
    };
  }

  if (tail === "files") {
    return { kind: "single", filePath: `courses/${courseId}/files.json` };
  }

  if (tail === "modules") {
    return { kind: "single", filePath: `courses/${courseId}/modules-items.json` };
  }

  return null;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

async function loadFixtureJson(relativePath: string): Promise<string> {
  const fileUrl = new URL(`../fixtures/${relativePath}`, import.meta.url);
  return await readFile(fileUrl, "utf8");
}
