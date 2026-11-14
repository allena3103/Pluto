import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { INTERNAL_SECRET_HEADER } from "@pluto/core/contract";
import { createCanvasClient } from "@pluto/canvas/client";
import { createDeadlineChangeNotifier, createDemoFixturesFetch, runDemoDateChange } from "@pluto/canvas/demo-trigger";
import { createFixtureFileFetch } from "@pluto/canvas/files-sync";
import { DEMO_STUDENT_ID } from "@pluto/canvas/host";
import { createDiskFixturesFetch } from "@pluto/canvas/sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";

// POST /api/canvas/demo-date-change
// Stage demo: a fixtures sync where History 105's Midterm Exam moved two days earlier,
// which sends exactly one deadline-change text. Always fixtures, never live Canvas.
// Auth (before any database work):
//   - `x-internal-secret` == INTERNAL_API_SECRET (timing-safe) with `{ studentId }` in the body; or
//   - a signed-in session, and then the target is the session user (demo student only).
// A present secret header never falls through to the session. Unset secret -> 500.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BODY_BYTES = 8_000;
const FIXTURES_BASE_URL = "https://fixtures.canvas.local";
const bodySchema = z.object({ studentId: z.guid() }).strict();

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function secretsEqual(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) {
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return timingSafeEqual(providedBuf, expectedBuf);
}

async function internalStudentId(request: Request): Promise<string | Response> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: "Invalid JSON body" }, 400);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const result = bodySchema.safeParse(parsed);
  if (!result.success) return json({ error: "Body must be { studentId }" }, 400);
  return result.data.studentId;
}

async function authenticate(request: Request): Promise<string | Response> {
  const provided = request.headers.get(INTERNAL_SECRET_HEADER);
  if (provided !== null) {
    const expected = process.env.INTERNAL_API_SECRET;
    if (!expected) return json({ error: "Internal API is not configured" }, 500);
    if (!secretsEqual(provided, expected)) return json({ error: "Unauthorized" }, 401);
    return internalStudentId(request);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return json({ error: "Unauthorized" }, 401);
  // The body is ignored on this path: the target is always the session user.
  if (data.user.id !== DEMO_STUDENT_ID) {
    return json({ error: "The date-change demo is only for the demo student" }, 403);
  }
  return data.user.id;
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  const studentId = auth;

  let appUrl: string;
  let internalSecret: string;
  let admin: ReturnType<typeof createAdminClient>;
  try {
    const env = getServerEnv();
    appUrl = env.appUrl;
    internalSecret = env.internalApiSecret;
    admin = createAdminClient();
  } catch {
    return json({ error: "Server is not configured" }, 500);
  }

  try {
    const client = createCanvasClient({
      baseUrl: FIXTURES_BASE_URL,
      token: "",
      mode: "fixtures",
      fetch: createDemoFixturesFetch(createDiskFixturesFetch(FIXTURES_BASE_URL)),
    });
    const notifier = createDeadlineChangeNotifier({ admin, studentId, appUrl, internalSecret });
    const result = await runDemoDateChange({
      admin,
      studentId,
      client,
      notifier,
      files: { download: { baseUrl: FIXTURES_BASE_URL, fetch: createFixtureFileFetch() } },
    });
    return json({ ok: true, ...result });
  } catch (error) {
    console.error("canvas demo-date-change failed:", error instanceof Error ? error.name : "unknown error");
    return json({ error: "Demo date change failed" }, 500);
  }
}
