// Stage demo: a fixtures-mode sync whose History 105 Midterm Exam moved two days earlier
// (Thu of week +3 -> Tue of week +3). The sync spots the move and sends one deadline-change
// text. Running it again changes nothing, so no second text; on top of that the notifier
// refuses to post twice for the same assignment within an hour.
//
// Demo fixture overrides live in `packages/canvas/fixtures/demo/courses/<course>/<file>`.
// Every request without an override is served by the normal fixtures.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PlutoDb } from "@pluto/core/context";
import { AlertDeadlineChangeRequest, INTERNAL_SECRET_HEADER } from "@pluto/core/contract";
import type { CanvasClient } from "./client";
import { syncCanvasFiles, type FilesSyncDeps, type FilesSyncResult } from "./files-sync";
import { errorText } from "./map";
import { syncCanvas, type DueDateChange, type SyncResult } from "./sync";

export const DEMO_DUPLICATE_WINDOW_MS = 60 * 60 * 1000;
const NOTIFY_TIMEOUT_MS = 10_000;
const EASTERN = "America/New_York";
const DUE_TEMPLATE = /^\{\{due:weeks=(-?\d+),days=(-?\d+)\}\}$/;

export type AlertOutcome =
  | { assignmentId: string; title: string; status: "sent"; httpStatus: number; response: unknown }
  | { assignmentId: string; title: string; status: "duplicate" }
  | { assignmentId: string; title: string; status: "failed"; error: string };

export type DeadlineNotifier = {
  notify: (change: DueDateChange) => Promise<void>;
  outcomes: AlertOutcome[];
};

/**
 * POSTs `/api/alerts/deadline-change` once per change, unless this student already has a
 * `date_change` alert for that assignment from the last hour (then it records `duplicate`).
 */
export function createDeadlineChangeNotifier(input: {
  admin: PlutoDb;
  studentId: string;
  appUrl: string;
  internalSecret: string;
  fetch?: typeof fetch;
  now?: () => Date;
}): DeadlineNotifier {
  const outcomes: AlertOutcome[] = [];
  const fetchImpl = input.fetch ?? fetch;
  const now = input.now ?? (() => new Date());

  const notify = async (change: DueDateChange): Promise<void> => {
    const base = { assignmentId: change.assignmentId, title: change.title };
    try {
      const since = new Date(now().getTime() - DEMO_DUPLICATE_WINDOW_MS).toISOString();
      const { count, error } = await input.admin
        .from("alerts")
        .select("id", { count: "exact", head: true })
        .eq("student_id", input.studentId)
        .eq("kind", "date_change")
        .eq("assignment_id", change.assignmentId)
        .gte("created_at", since);
      if (error) throw new Error(`duplicate check failed: ${errorText(error)}`);
      if ((count ?? 0) > 0) {
        outcomes.push({ ...base, status: "duplicate" });
        return;
      }

      const body = AlertDeadlineChangeRequest.parse({
        studentId: input.studentId,
        assignmentId: change.assignmentId,
        oldDueAt: change.oldDueAt,
        newDueAt: change.newDueAt,
      });
      let response: Response;
      try {
        response = await fetchImpl(`${input.appUrl.replace(/\/+$/, "")}/api/alerts/deadline-change`, {
          method: "POST",
          headers: { "content-type": "application/json", [INTERNAL_SECRET_HEADER]: input.internalSecret },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
        });
      } catch (fetchError) {
        const name = fetchError instanceof Error ? fetchError.name : "Error";
        throw new Error(`deadline-change request failed (${name})`, { cause: fetchError });
      }
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`deadline-change returned status ${response.status}`);
      outcomes.push({ ...base, status: "sent", httpStatus: response.status, response: payload });
    } catch (notifyError) {
      outcomes.push({ ...base, status: "failed", error: errorText(notifyError) });
      throw notifyError;
    }
  };

  return { notify, outcomes };
}

export type DemoDateChangeDeps = {
  /** Service-role client. Every read and write is filtered by `studentId`. */
  admin: PlutoDb;
  studentId: string;
  /** A fixtures client that serves the demo set (see `createDemoFixturesFetch`). */
  client: CanvasClient;
  notifier: DeadlineNotifier;
  /** When set, PDFs are downloaded and ingested after the metadata sync. */
  files?: Pick<FilesSyncDeps, "download" | "ingest">;
  now?: Date;
};

export type DemoDateChangeResult = {
  sync: SyncResult;
  files: FilesSyncResult | null;
  alerts: AlertOutcome[];
};

export async function runDemoDateChange(deps: DemoDateChangeDeps): Promise<DemoDateChangeResult> {
  const sync = await syncCanvas({
    db: deps.admin,
    studentId: deps.studentId,
    client: deps.client,
    now: deps.now,
    notifyDueDateChange: deps.notifier.notify,
  });
  const files = deps.files
    ? await syncCanvasFiles({
        admin: deps.admin,
        studentId: deps.studentId,
        client: deps.client,
        download: deps.files.download,
        ingest: deps.files.ingest,
        now: deps.now,
      })
    : null;
  return { sync, files, alerts: [...deps.notifier.outcomes] };
}

// ---------------------------------------------------------------- demo fixtures

function findDemoCoursesDirectory(): string {
  const candidates = [
    path.resolve(process.cwd(), "fixtures/demo/courses"),
    path.resolve(process.cwd(), "packages/canvas/fixtures/demo/courses"),
    path.resolve(process.cwd(), "../../packages/canvas/fixtures/demo/courses"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Canvas demo fixtures directory was not found");
  return found;
}

/**
 * Wraps the normal fixtures fetch. A request whose fixture file has a twin under
 * `fixtures/demo/courses` gets the twin's body (templates resolved); status and headers
 * (including the pagination Link) come from the normal response.
 */
export function createDemoFixturesFetch(
  baseFetch: typeof fetch,
  options: { directory?: string; now?: () => Date } = {},
): typeof fetch {
  const directory = options.directory ?? findDemoCoursesDirectory();
  const now = options.now ?? (() => new Date());

  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (!response.ok) return response;
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const relative = overridePath(url);
    if (!relative) return response;

    const filePath = path.resolve(directory, relative);
    const inside = path.relative(directory, filePath);
    if (inside.startsWith("..") || path.isAbsolute(inside)) return response;
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch {
      return response;
    }
    await response.body?.cancel();
    const body = JSON.stringify(resolveTemplates(JSON.parse(raw) as unknown, now()));
    return new Response(body, { status: response.status, headers: response.headers });
  };
}

function overridePath(url: URL): string | null {
  const match = /^\/api\/v1\/courses\/([A-Za-z0-9-]+)\/(assignments|assignment_groups|files)$/.exec(url.pathname);
  if (!match) return null;
  const [, courseId, tail] = match;
  if (tail === "assignments") return `${courseId}/assignments.page${url.searchParams.get("page") ?? "1"}.json`;
  return `${courseId}/${tail}.json`;
}

/** Same rule as the normal fixtures and `supabase/seed.sql`: Monday of this week (ET) + offset, 23:59 ET. */
function resolveTemplates(value: unknown, now: Date): unknown {
  if (typeof value === "string") {
    const match = DUE_TEMPLATE.exec(value);
    return match ? resolveDue(Number(match[1]), Number(match[2]), now) : value;
  }
  if (Array.isArray(value)) return value.map((item) => resolveTemplates(item, now));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveTemplates(child, now)]));
  }
  return value;
}

function resolveDue(weeks: number, days: number, now: Date): string {
  const today = easternParts(now);
  const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
  const target = new Date(Date.UTC(today.year, today.month - 1, today.day - ((weekday + 6) % 7) + weeks * 7 + days));
  const desired = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), 23, 59, 0);
  let guess = desired;
  for (let i = 0; i < 5; i += 1) {
    const seen = easternParts(new Date(guess));
    const delta = desired - Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
    guess += delta;
    if (delta === 0) break;
  }
  return new Date(guess).toISOString().replace(".000Z", "Z");
}

function easternParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}
