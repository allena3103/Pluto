import { createHash, timingSafeEqual } from "node:crypto";
import { runAgent as defaultRunAgent } from "@pluto/agent";
import type { PlutoDb } from "@pluto/core/context";
import { makeToolContext } from "@pluto/core/context";
import { AgentReplyRequest, AgentReplyResponse, DeepLink, INTERNAL_SECRET_HEADER } from "@pluto/core/contract";
import { createSmsMagicLink as defaultCreateSmsMagicLink } from "./sms-magic-link";

export type RunAgentFn = typeof defaultRunAgent;

export type AgentReplyDeps = {
  /** `INTERNAL_API_SECRET`. Missing means the route refuses to run. */
  expectedSecret: string | undefined;
  /** Called only after the secret matches. */
  createAdmin: () => PlutoDb;
  appUrl: string | undefined;
  llm?: "mock" | "gemini";
  runAgent?: RunAgentFn;
  createSmsMagicLink?: typeof defaultCreateSmsMagicLink;
};

const REPLY_TIMEOUT_MS = 25_000;
const FALLBACK_TEXT = "I couldn't put an answer together just now. Try again in a moment.";

/** SHA-256 both sides so the compare is constant-time whatever the lengths. */
export function secretMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function llmFromEnv(value: string | undefined): "mock" | "gemini" {
  return value === "gemini" ? "gemini" : "mock";
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/** Appends the URL on its own, unless the reply already contains it. */
export function withLink(text: string, url: string): string {
  const trimmed = text.trim();
  if (trimmed.includes(url)) return trimmed;
  return trimmed ? `${trimmed} ${url}` : url;
}

/**
 * POST /api/agent/reply. Server-to-server. The secret is checked before the body
 * is read and before the service-role client exists.
 */
export async function handleAgentReply(request: Request, deps: AgentReplyDeps): Promise<Response> {
  if (!deps.expectedSecret || !deps.appUrl) {
    return json({ error: "Server is not configured." }, 500);
  }
  if (!secretMatches(request.headers.get(INTERNAL_SECRET_HEADER), deps.expectedSecret)) {
    return json({ error: "Unauthorized." }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }
  const parsed = AgentReplyRequest.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Body must be { studentId, text, channel }." }, 400);
  }
  const { studentId, text, channel } = parsed.data;

  try {
    const admin = deps.createAdmin();
    const ctx = makeToolContext({ db: admin, studentId, appUrl: deps.appUrl });
    const runAgent = deps.runAgent ?? defaultRunAgent;
    // `model` is never taken from the request. The agent reads GEMINI_MODEL itself.
    const result = await runAgent({
      message: text,
      channel,
      ctx,
      llm: deps.llm,
      signal: AbortSignal.timeout(REPLY_TIMEOUT_MS),
    });
    const first = result.citations[0];
    let reply = result.text.trim() || FALLBACK_TEXT;
    let deepLink: string | undefined;

    if (channel === "sms") {
      // Minted by the host from the first cited page; the student id comes from the verified body.
      const create = deps.createSmsMagicLink ?? defaultCreateSmsMagicLink;
      const url = await create({ admin, studentId, appUrl: deps.appUrl }, first);
      if (url) {
        reply = withLink(reply, url);
        deepLink = url;
      }
    } else if (first && DeepLink.safeParse(first.deepLink).success) {
      deepLink = first.deepLink;
    }

    const response = AgentReplyResponse.parse(deepLink ? { text: reply, deepLink } : { text: reply });
    return json(response);
  } catch (err) {
    console.error("agent reply failed:", err instanceof Error ? err.message : "unknown error");
    return json({ error: "Reply failed." }, 500);
  }
}
