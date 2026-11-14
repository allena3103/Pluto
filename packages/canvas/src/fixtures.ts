import { readFile } from "node:fs/promises";

const API_PREFIX = "/api/v1";
const JSON_HEADERS = { "Content-Type": "application/json" };
const EASTERN_TIME_ZONE = "America/New_York";
const DUE_TEMPLATE_REGEX = /^\{\{due:weeks=(-?\d+),days=(-?\d+)\}\}$/;

type FixturePage = {
  filePath: string;
  next?: string;
};

type FixtureRoute =
  | { kind: "single"; filePath: string }
  | { kind: "paged"; pages: Record<string, FixturePage> };

export function createFixturesFetch(
  baseUrl: string,
  options?: { now?: () => Date },
): typeof fetch {
  const normalizedBase = trimTrailingSlash(baseUrl);
  const now = options?.now ?? (() => new Date());

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
      const body = await loadFixtureJson(route.filePath, now);
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

    const body = await loadFixtureJson(pageConfig.filePath, now);
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

async function loadFixtureJson(
  relativePath: string,
  nowProvider: () => Date,
): Promise<string> {
  const fileUrl = new URL(`../fixtures/${relativePath}`, import.meta.url);
  const rawJson = await readFile(fileUrl, "utf8");
  const parsed = JSON.parse(rawJson) as unknown;
  const resolved = resolveTemplates(parsed, nowProvider());
  return JSON.stringify(resolved);
}

function resolveTemplates(value: unknown, now: Date): unknown {
  if (typeof value === "string") {
    return resolveTemplateString(value, now);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplates(item, now));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = resolveTemplates(child, now);
    }
    return output;
  }
  return value;
}

function resolveTemplateString(value: string, now: Date): string {
  const match = DUE_TEMPLATE_REGEX.exec(value);
  if (!match) {
    return value;
  }
  const weeks = Number(match[1]);
  const days = Number(match[2]);
  return resolveDueTemplate(weeks, days, now);
}

function resolveDueTemplate(weeks: number, days: number, now: Date): string {
  const nowParts = getTimeZoneParts(now, EASTERN_TIME_ZONE);
  const weekday = getWeekday(nowParts.year, nowParts.month, nowParts.day);
  const daysSinceMonday = (weekday + 6) % 7;
  const monday = addDaysToCivilDate(
    nowParts.year,
    nowParts.month,
    nowParts.day,
    -daysSinceMonday,
  );

  const target = addDaysToCivilDate(
    monday.year,
    monday.month,
    monday.day,
    weeks * 7 + days,
  );

  const targetUtc = easternLocalDateTimeToUtc(
    target.year,
    target.month,
    target.day,
    23,
    59,
    0,
  );
  return targetUtc.toISOString().replace(".000Z", "Z");
}

function getWeekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function addDaysToCivilDate(
  year: number,
  month: number,
  day: number,
  deltaDays: number,
): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function easternLocalDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date {
  let guessUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const desiredUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);

  // Iterate until the guessed UTC instant formats back to the desired local time.
  for (let i = 0; i < 5; i += 1) {
    const guessDate = new Date(guessUtcMs);
    const parts = getTimeZoneParts(guessDate, EASTERN_TIME_ZONE);
    const observedUtcMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const delta = desiredUtcMs - observedUtcMs;
    guessUtcMs += delta;
    if (delta === 0) {
      break;
    }
  }

  return new Date(guessUtcMs);
}

function getTimeZoneParts(
  date: Date,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find((item) => item.type === type);
    if (!part) {
      throw new Error(`Missing Intl part: ${type}`);
    }
    return Number(part.value);
  };

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}
