import { calendarFeedUrl, newFeedToken } from "@pluto/core/ics";
import { makeToolContext, type PlutoDb } from "@pluto/core/context";
import { AlertDemoRequest, AlertResponse, INTERNAL_SECRET_HEADER, type CrunchWeek } from "@pluto/core/contract";
import { sendSms as defaultSendSms, type SmsProvider } from "@pluto/core/sms";
import { getCrunchWeeks as defaultGetCrunchWeeks } from "@pluto/core/tools/index";
import { secretMatches } from "./agent-reply";

// Shared by POST /api/alerts/demo and POST /api/alerts/deadline-change.

export const STUDY_BLOCK_MINUTES = 90;
export const CRUNCH_WEEKS_AHEAD = 8;
/** UMass Amherst. Dates in texts are written in this zone. */
export const ALERT_TIME_ZONE = "America/New_York";

export type SendSmsFn = typeof defaultSendSms;

export type AlertSmsDeps = {
  provider: SmsProvider;
  sendSms?: SendSmsFn;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
};

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/** A block of `STUDY_BLOCK_MINUTES` ending at `dueAt`, or null if the date is unusable. */
export function studyBlockEndingAt(dueAt: string): { startsAt: string; endsAt: string } | null {
  const end = new Date(dueAt);
  if (Number.isNaN(end.getTime())) return null;
  const start = new Date(end.getTime() - STUDY_BLOCK_MINUTES * 60_000);
  if (!(end.getTime() > start.getTime())) return null;
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ALERT_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

export function formatDayTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ALERT_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** `weekStart`/`weekEnd` are `YYYY-MM-DD`; format them as plain dates (no zone shift). */
function formatDateOnly(date: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

export function crunchMessage(week: CrunchWeek | undefined, calendarUrl: string): string {
  if (!week) {
    return `Pluto: nothing is due in the next ${CRUNCH_WEEKS_AHEAD} weeks. Your study calendar: ${calendarUrl}`;
  }
  const count = week.deliverableCount;
  const weight = week.totalWeightPercent > 0 ? ` worth ${Math.round(week.totalWeightPercent)}% of your grades` : "";
  return (
    `Pluto: your heaviest week is ${formatDateOnly(week.weekStart)}-${formatDateOnly(week.weekEnd)}: ` +
    `${count} ${count === 1 ? "thing" : "things"} due${weight}. ` +
    `I added a ${STUDY_BLOCK_MINUTES}-minute study block before each. Add them to your calendar: ${calendarUrl} ` +
    `Want a plan? Reply YES.`
  );
}

/**
 * Texts the student's linked phone and stamps `alerts.sent_at`.
 * Returns false (never throws) when there is no phone or the send fails; the alert row stays.
 */
export async function sendAlertText(
  admin: PlutoDb,
  deps: AlertSmsDeps,
  input: { studentId: string; alertId: string; body: string },
): Promise<boolean> {
  const { data: profile, error } = await admin
    .from("profiles")
    .select("phone")
    .eq("id", input.studentId)
    .maybeSingle();
  if (error) throw new Error(`failed to load profile: ${error.message}`);
  const phone = profile?.phone;
  if (!phone) return false;

  const send = deps.sendSms ?? defaultSendSms;
  const result = await send(
    { admin, provider: deps.provider, env: deps.env, fetch: deps.fetch },
    { studentId: input.studentId, to: phone, body: input.body },
  );
  if (!result.ok) {
    console.error("alert sms failed:", result.error);
    return false;
  }

  const { error: stampError } = await admin
    .from("alerts")
    .update({ sent_at: new Date().toISOString() })
    .eq("student_id", input.studentId)
    .eq("id", input.alertId);
  // The text is out; a missing timestamp must not turn this into a failure (a retry would text twice).
  if (stampError) console.error("failed to stamp alert sent_at:", stampError.message);
  return true;
}

// ---------------------------------------------------------------- POST /api/alerts/demo

export type AlertsDemoDeps = AlertSmsDeps & {
  /** `INTERNAL_API_SECRET`. When unset, only the session path works. */
  expectedSecret: string | undefined;
  appUrl: string | undefined;
  /** `auth.uid()` of the session, or null. Called only when no internal secret header is sent. */
  getSessionUserId: () => Promise<string | null>;
  /** Called only after auth passes. */
  createAdmin: () => PlutoDb;
  getCrunchWeeks?: typeof defaultGetCrunchWeeks;
};

/**
 * POST /api/alerts/demo  { studentId }  ->  AlertResponse.
 * Auth: a valid `x-internal-secret` (checked first), or a session whose user is `studentId`.
 */
export async function handleAlertsDemo(request: Request, deps: AlertsDemoDeps): Promise<Response> {
  if (!deps.appUrl) return json({ error: "Server is not configured." }, 500);

  const header = request.headers.get(INTERNAL_SECRET_HEADER);
  let sessionUserId: string | null = null;
  if (header !== null) {
    if (!deps.expectedSecret || !secretMatches(header, deps.expectedSecret)) {
      return json({ error: "Unauthorized." }, 401);
    }
  } else {
    sessionUserId = await deps.getSessionUserId();
    if (!sessionUserId) return json({ error: "Unauthorized." }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }
  const parsed = AlertDemoRequest.safeParse(body);
  if (!parsed.success) return json({ error: "Body must be { studentId }." }, 400);
  const { studentId } = parsed.data;

  if (sessionUserId !== null && sessionUserId !== studentId) {
    return json({ error: "Forbidden." }, 403);
  }

  try {
    const admin = deps.createAdmin();
    const ctx = makeToolContext({ db: admin, studentId, appUrl: deps.appUrl });
    const getCrunchWeeks = deps.getCrunchWeeks ?? defaultGetCrunchWeeks;
    const { weeks } = await getCrunchWeeks(ctx, { weeksAhead: CRUNCH_WEEKS_AHEAD });
    const week = weeks.find((w) => w.rank === 1);

    const token = newFeedToken();
    const calendarUrl = calendarFeedUrl(ctx.appUrl, token);
    const message = crunchMessage(week, calendarUrl);

    const { data: alert, error: alertError } = await admin
      .from("alerts")
      .insert({
        student_id: studentId,
        kind: "crunch_week",
        week_start: week?.weekStart ?? null,
        message,
        calendar_feed_token: token,
      })
      .select("id")
      .single();
    if (alertError || !alert) throw new Error(`failed to insert alert: ${alertError?.message ?? "no row"}`);

    const blocks = (week?.assignments ?? []).flatMap((a) => {
      const slot = studyBlockEndingAt(a.dueAt);
      if (!slot) return [];
      return [
        {
          student_id: studentId,
          alert_id: alert.id,
          course_id: a.courseId,
          title: `Study: ${a.title} (${a.courseName})`,
          starts_at: slot.startsAt,
          ends_at: slot.endsAt,
        },
      ];
    });
    if (blocks.length > 0) {
      const { error: blocksError } = await admin.from("study_blocks").insert(blocks);
      if (blocksError) throw new Error(`failed to insert study blocks: ${blocksError.message}`);
    }

    const sent = await sendAlertText(admin, deps, { studentId, alertId: alert.id, body: message });
    return json(AlertResponse.parse({ alertId: alert.id, sent, calendarUrl }));
  } catch (err) {
    console.error("crunch alert failed:", err instanceof Error ? err.message : "unknown error");
    return json({ error: "Alert failed." }, 500);
  }
}
