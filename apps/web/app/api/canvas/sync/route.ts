import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AlertDeadlineChangeRequest, INTERNAL_SECRET_HEADER } from "@pluto/core/contract";
import { createCanvasClient } from "@pluto/canvas/client";
import { createDiskFixturesFetch, syncCanvas, type DueDateChange, type SyncResult } from "@pluto/canvas/sync";
import { decryptCanvasToken } from "@pluto/canvas/token-crypto";
import { CanvasAuthError, CanvasRateLimitError, CanvasTimeoutError } from "@pluto/canvas/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BODY_BYTES = 8_000;
const FIXTURES_BASE_URL = "https://fixtures.canvas.local";

const bodySchema = z.object({
  studentId: z.guid().optional(),
});

type AuthOk = { studentId: string };
type AuthFailure = { response: Response };

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

function scrub(value: string, secrets: readonly string[]): string {
  let out = value;
  for (const secret of secrets) {
    if (!secret) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

function scrubValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return scrub(value, secrets);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, secrets));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = scrubValue(child, secrets);
    }
    return out;
  }
  return value;
}

function respond(body: unknown, status: number, secrets: readonly string[]): Response {
  return json(scrubValue(body, secrets), status);
}

async function readBody(request: Request): Promise<{ studentId?: string } | AuthFailure> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { response: json({ error: "Invalid JSON body" }, 400) };
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { response: json({ error: "Invalid JSON body" }, 400) };
  }
  const result = bodySchema.safeParse(parsed);
  if (!result.success) return { response: json({ error: "Invalid studentId" }, 400) };
  return { studentId: result.data.studentId };
}

function isAuthFailure(value: { studentId?: string } | AuthFailure): value is AuthFailure {
  return "response" in value;
}

/**
 * Internal callers present `x-internal-secret` and a body studentId.
 * A present header never falls through to the session, including when the
 * secret is unset (500) or wrong (401). Session callers always use the
 * signed-in user id.
 */
async function authenticate(request: Request): Promise<AuthOk | AuthFailure> {
  const provided = request.headers.get(INTERNAL_SECRET_HEADER);
  if (provided !== null) {
    const expected = process.env.INTERNAL_API_SECRET;
    if (!expected) return { response: json({ error: "Internal API is not configured" }, 500) };
    if (!secretsEqual(provided, expected)) return { response: json({ error: "Unauthorized" }, 401) };

    const body = await readBody(request);
    if (isAuthFailure(body)) return body;
    if (!body.studentId) return { response: json({ error: "studentId is required" }, 400) };
    return { studentId: body.studentId };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { response: json({ error: "Unauthorized" }, 401) };

  const body = await readBody(request);
  if (isAuthFailure(body)) return body;
  if (body.studentId && body.studentId !== data.user.id) {
    return { response: json({ error: "Forbidden" }, 403) };
  }
  return { studentId: data.user.id };
}

function canvasMode(): "live" | "fixtures" {
  return process.env.CANVAS_MODE === "live" ? "live" : "fixtures";
}

function canvasOrigin(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function canvasFailure(error: unknown): Response | null {
  if (error instanceof CanvasAuthError) return json({ error: "Canvas rejected the access token" }, 400);
  if (error instanceof CanvasRateLimitError) return json({ error: "Canvas rate limit exceeded" }, 502);
  if (error instanceof CanvasTimeoutError) return json({ error: "Canvas request timed out" }, 502);
  return null;
}

function notifyDueDateChange(input: {
  appUrl: string;
  internalSecret: string;
  studentId: string;
}): (change: DueDateChange) => Promise<void> {
  return async (change) => {
    const parsed = AlertDeadlineChangeRequest.safeParse({
      studentId: input.studentId,
      assignmentId: change.assignmentId,
      oldDueAt: change.oldDueAt,
      newDueAt: change.newDueAt,
    });
    if (!parsed.success) {
      throw new Error("Deadline change notification payload was invalid");
    }

    let response: Response;
    try {
      response = await fetch(`${input.appUrl}/api/alerts/deadline-change`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [INTERNAL_SECRET_HEADER]: input.internalSecret,
        },
        body: JSON.stringify(parsed.data),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      throw new Error(`Deadline change notification failed (${name})`);
    }

    if (!response.ok) {
      throw new Error(`Deadline change notification failed with status ${response.status}`);
    }
  };
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  let appUrl: string;
  let internalSecret: string;
  let admin: ReturnType<typeof createAdminClient>;
  try {
    const env = getServerEnv();
    appUrl = env.appUrl.replace(/\/+$/, "");
    internalSecret = env.internalApiSecret;
    admin = createAdminClient();
  } catch {
    return json({ error: "Server is not configured" }, 500);
  }

  const studentId = auth.studentId;
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("canvas_base_url, canvas_token_encrypted")
    .eq("id", studentId)
    .maybeSingle();

  if (profileError) return json({ error: "Failed to load Canvas connection" }, 500);

  const ciphertext = profile?.canvas_token_encrypted ?? null;
  const mode = canvasMode();
  let token = "";
  let baseUrl = canvasOrigin(profile?.canvas_base_url) ?? canvasOrigin(process.env.CANVAS_BASE_URL);

  if (mode === "live") {
    if (ciphertext) {
      try {
        token = decryptCanvasToken(ciphertext);
      } catch {
        return json({ error: "Stored Canvas token could not be decrypted" }, 400);
      }
    }
    if (!token) token = process.env.CANVAS_API_TOKEN?.trim() ?? "";
    if (!token || !baseUrl) {
      return json(
        { error: "Canvas is not connected. Save a token or set CANVAS_API_TOKEN and CANVAS_BASE_URL." },
        400,
      );
    }
  } else if (!baseUrl) {
    baseUrl = FIXTURES_BASE_URL;
  }

  const secrets = [token, ciphertext ?? "", process.env.CANVAS_API_TOKEN ?? "", internalSecret];

  try {
    const client = createCanvasClient({
      baseUrl,
      token,
      mode,
      fetch: mode === "fixtures" ? createDiskFixturesFetch(baseUrl) : undefined,
    });
    const result: SyncResult = await syncCanvas({
      db: admin,
      studentId,
      client,
      notifyDueDateChange: notifyDueDateChange({ appUrl, internalSecret, studentId }),
    });
    return respond({ ok: true, result }, 200, secrets);
  } catch (error) {
    const mapped = canvasFailure(error);
    if (mapped) return mapped;
    return respond({ error: "Canvas sync failed" }, 500, secrets);
  }
}
