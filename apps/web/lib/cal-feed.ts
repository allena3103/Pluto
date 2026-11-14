import type { PlutoDb } from "@pluto/core/context";
import { CAL_FEED_RESPONSE, CalFeedParams } from "@pluto/core/contract";
import { buildIcs, getCalendarFeed as defaultGetCalendarFeed } from "@pluto/core/ics";

export type CalFeedDeps = {
  /** Called only after the path segment parses as `<token>.ics`. */
  createAdmin: () => PlutoDb;
  getCalendarFeed?: typeof defaultGetCalendarFeed;
  now?: Date;
};

const ICS_SUFFIX = ".ics";
// newFeedToken() is base64url.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/** `abc.ics` -> `abc`; anything else -> null. */
export function feedTokenFromSegment(segment: string): string | null {
  if (!segment.endsWith(ICS_SUFFIX)) return null;
  const token = segment.slice(0, -ICS_SUFFIX.length);
  if (!TOKEN_PATTERN.test(token)) return null;
  const parsed = CalFeedParams.safeParse({ token });
  return parsed.success ? parsed.data.token : null;
}

/** GET /cal/<token>.ics. The token is the only credential; unknown tokens are 404. */
export async function handleCalFeed(segment: string, deps: CalFeedDeps): Promise<Response> {
  const token = feedTokenFromSegment(segment);
  if (!token) return notFound();

  try {
    const admin = deps.createAdmin();
    const feed = await (deps.getCalendarFeed ?? defaultGetCalendarFeed)(admin, token);
    if (!feed) return notFound();

    const ics = buildIcs({
      calendarName: "Pluto study plan",
      now: deps.now,
      events: feed.events.map((event) => ({
        uid: `${event.id}@pluto`,
        title: event.title,
        start: event.start,
        end: event.end,
      })),
    });
    return new Response(ics, {
      status: 200,
      headers: {
        "content-type": CAL_FEED_RESPONSE.contentType,
        "cache-control": "private, no-store",
        "x-robots-tag": "noindex",
      },
    });
  } catch (err) {
    console.error("calendar feed failed:", err instanceof Error ? err.message : "unknown error");
    return new Response("Calendar unavailable", { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
