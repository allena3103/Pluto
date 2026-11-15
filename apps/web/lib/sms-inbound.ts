import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAgent as defaultRunAgent } from "@pluto/agent";
import { makeToolContext, type PlutoDb } from "@pluto/core/context";
import { SmsInboundRequest, SmsInboundResponse } from "@pluto/core/contract";
import {
  findStudentByPhone as defaultFindStudentByPhone,
  normalizePhone,
  recordInboundSms as defaultRecordInboundSms,
  sendSms as defaultSendSms,
  type SmsProvider,
} from "@pluto/core/sms";
import { secretMatches, withLink } from "./agent-reply";
import { buildPlanRequest, findRecentCrunchAlert, isYesReply } from "./crunch-plan";
import { consumeLinkCode as defaultConsumeLinkCode } from "./phone-link";
import { createSmsMagicLink as defaultCreateSmsMagicLink } from "./sms-magic-link";

/**
 * Sendblue puts the webhook secret you configure (per webhook `secret`, or the
 * account `globalSecret`) in a request header, as a plain shared value, not an HMAC:
 * https://docs.sendblue.com/getting-started/webhooks ("Verify Webhook Signatures").
 * That page does not name the header. Sendblue sends it as `sb-signing-secret`;
 * `sb-webhook-secret` is accepted too in case the name differs. Both are compared
 * timing-safe against SENDBLUE_WEBHOOK_SECRET before anything else runs.
 */
export const SENDBLUE_SECRET_HEADERS = ["sb-signing-secret", "sb-webhook-secret"] as const;

export const LINK_PATTERN = /^LINK\s+([A-Za-z0-9]{6})\s*$/i;

export const LINKED_TEXT = "Your phone is linked to Pluto.";
export const LINK_FAILED_TEXT =
  "That code didn't work. Sign in to Pluto, get a new code on the phone settings page, and text LINK plus the code.";
export const UNKNOWN_NUMBER_TEXT =
  "Hi! This number isn't linked to Pluto yet. Sign in to Pluto, get a code on the phone settings page, and text LINK plus the code.";
const FALLBACK_TEXT = "I couldn't put an answer together just now. Try again in a moment.";

export type InboundPayload = ReturnType<typeof SmsInboundRequest.parse>;

const AGENT_TIMEOUT_MS = 25_000;
const SENDBLUE_SEND_MESSAGE_URL = "https://api.sendblue.co/api/send-message";
const SENDBLUE_TIMEOUT_MS = 10_000;

export type InboundOutcome =
  | "duplicate"
  | "ignored"
  | "linked"
  | "link_failed"
  | "unknown_number"
  | "answered";

export type InboundResult = {
  outcome: InboundOutcome;
  /** The text Pluto replied with (also sent), when it replied. */
  reply?: string;
  /** Student the reply was stored for, when there is one. */
  studentId?: string;
  /** True when the reply reached the provider (or the simulator log). */
  sent?: boolean;
};

export type SmsInboundDeps = {
  /** Service-role client. Only called after the caller verified the request. */
  createAdmin: () => PlutoDb;
  appUrl: string;
  provider: SmsProvider;
  llm?: "mock" | "gemini";
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  runAgent?: typeof defaultRunAgent;
  sendSms?: typeof defaultSendSms;
  recordInboundSms?: typeof defaultRecordInboundSms;
  findStudentByPhone?: typeof defaultFindStudentByPhone;
  consumeLinkCode?: typeof defaultConsumeLinkCode;
  createSmsMagicLink?: typeof defaultCreateSmsMagicLink;
};

/**
 * `sms_inbound_receipts` is not in `Database`. This cast is the only place that
 * names the table.
 */
type ReceiptsDatabase = {
  public: {
    Tables: {
      sms_inbound_receipts: {
        Row: { dedupe_key: string; created_at: string };
        Insert: { dedupe_key: string };
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};

function receipts(admin: PlutoDb) {
  return (admin as unknown as SupabaseClient<ReceiptsDatabase>).from("sms_inbound_receipts");
}

/** Provider message id when present, otherwise SHA-256 of `from_number + "\n" + content`. */
export function dedupeKey(payload: InboundPayload): string {
  const handle = payload.message_handle;
  if (typeof handle === "string" && handle.trim() && handle.length <= 190) {
    return `sendblue:${handle.trim()}`;
  }
  return `sha256:${createHash("sha256").update(`${payload.from_number}\n${payload.content}`).digest("hex")}`;
}

/** Inserts the receipt first. Returns false when this delivery was already seen. */
async function claimReceipt(admin: PlutoDb, key: string): Promise<boolean> {
  const { error } = await receipts(admin).insert({ dedupe_key: key });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`could not record the sms receipt (${error.code ?? "error"})`);
}

/**
 * Reply to a number that has no student (unknown number, failed LINK). There is
 * no student to own an `sms_messages` row, so nothing is stored. The simulator
 * shows this text from the action result instead.
 */
async function sendUnlinkedReply(deps: SmsInboundDeps, to: string, body: string): Promise<boolean> {
  if (deps.provider !== "sendblue") return true;
  const env = deps.env ?? process.env;
  const keyId = env.SENDBLUE_API_KEY_ID;
  const secretKey = env.SENDBLUE_API_SECRET;
  const fromNumber = env.SENDBLUE_FROM_NUMBER;
  if (!keyId || !secretKey || !fromNumber) return false;
  try {
    const response = await (deps.fetch ?? fetch)(SENDBLUE_SEND_MESSAGE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "sb-api-key-id": keyId, "sb-api-secret-key": secretKey },
      body: JSON.stringify({ number: to, from_number: fromNumber, content: body }),
      signal: AbortSignal.timeout(SENDBLUE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function replyToStudent(
  deps: SmsInboundDeps,
  admin: PlutoDb,
  studentId: string,
  to: string,
  body: string,
): Promise<boolean> {
  const send = deps.sendSms ?? defaultSendSms;
  const result = await send({ admin, provider: deps.provider, env: deps.env, fetch: deps.fetch }, { studentId, to, body });
  if (!result.ok) console.error("sms reply failed:", result.error);
  return result.ok;
}

/**
 * Handles one verified inbound message. Callers: the Sendblue webhook (after the
 * secret check) and the `/sms-sim` server action (after the session check).
 */
export async function processInboundSms(payload: InboundPayload, deps: SmsInboundDeps): Promise<InboundResult> {
  // Sendblue can post status events for messages Pluto sent. Never answer those.
  if (payload.is_outbound === true) return { outcome: "ignored" };

  const admin = deps.createAdmin();
  if (!(await claimReceipt(admin, dedupeKey(payload)))) return { outcome: "duplicate" };

  const from = normalizePhone(payload.from_number);
  if (!from) return { outcome: "ignored" };

  const content = payload.content.trim();
  const link = LINK_PATTERN.exec(content);
  if (link) {
    const consume = deps.consumeLinkCode ?? defaultConsumeLinkCode;
    const result = await consume(admin, link[1]!, from);
    if (result.ok) {
      const record = deps.recordInboundSms ?? defaultRecordInboundSms;
      // The code is spent, but there is no reason to keep it.
      await record(admin, { studentId: result.studentId, from, body: "LINK ******", provider: deps.provider });
      const sent = await replyToStudent(deps, admin, result.studentId, from, LINKED_TEXT);
      return { outcome: "linked", reply: LINKED_TEXT, studentId: result.studentId, sent };
    }
    const sent = await sendUnlinkedReply(deps, from, LINK_FAILED_TEXT);
    return { outcome: "link_failed", reply: LINK_FAILED_TEXT, sent };
  }

  const find = deps.findStudentByPhone ?? defaultFindStudentByPhone;
  const student = await find(admin, from);
  if (!student) {
    const sent = await sendUnlinkedReply(deps, from, UNKNOWN_NUMBER_TEXT);
    return { outcome: "unknown_number", reply: UNKNOWN_NUMBER_TEXT, sent };
  }

  const { studentId } = student;
  const record = deps.recordInboundSms ?? defaultRecordInboundSms;
  await record(admin, { studentId, from, body: content || "(empty message)", provider: deps.provider });

  const ctx = makeToolContext({ db: admin, studentId, appUrl: deps.appUrl });
  const runAgent = deps.runAgent ?? defaultRunAgent;
  // A short yes to a recent crunch-week text asks for that week's plan. The request
  // is built from the alert row, never from the text.
  let message = content;
  if (isYesReply(content)) {
    const alert = await findRecentCrunchAlert(admin, studentId);
    const request = alert ? buildPlanRequest(alert.weekStart) : null;
    if (request) message = request;
  }
  const result = await runAgent({
    message,
    channel: "sms",
    ctx,
    llm: deps.llm,
    signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
  });

  let reply = result.text.trim() || FALLBACK_TEXT;
  // Minted by the host from the first cited page, for the student found by phone.
  const create = deps.createSmsMagicLink ?? defaultCreateSmsMagicLink;
  const url = await create({ admin, studentId, appUrl: deps.appUrl }, result.citations[0]);
  if (url) reply = withLink(reply, url);

  const sent = await replyToStudent(deps, admin, studentId, from, reply);
  return { outcome: "answered", reply, studentId, sent };
}

export type SmsWebhookDeps = SmsInboundDeps & {
  /** `SENDBLUE_WEBHOOK_SECRET`. Missing means the route refuses to run. */
  expectedSecret: string | undefined;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/** True when any accepted Sendblue secret header matches. Every header is compared. */
export function webhookSecretMatches(headers: Headers, expected: string): boolean {
  let ok = false;
  for (const name of SENDBLUE_SECRET_HEADERS) {
    if (secretMatches(headers.get(name), expected)) ok = true;
  }
  return ok;
}

/**
 * POST /api/sms/inbound. The secret is checked before the body is read and before
 * the service-role client exists. After the receipt is stored, errors still return
 * 200 so Sendblue does not retry into a duplicate.
 */
export async function handleSmsWebhook(request: Request, deps: SmsWebhookDeps): Promise<Response> {
  if (!deps.expectedSecret || !deps.appUrl) {
    return json({ error: "Server is not configured." }, 500);
  }
  if (!webhookSecretMatches(request.headers, deps.expectedSecret)) {
    return json({ error: "Unauthorized." }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }
  const parsed = SmsInboundRequest.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Body must include from_number and content." }, 400);
  }

  try {
    await processInboundSms(parsed.data, deps);
    return json(SmsInboundResponse.parse({ ok: true }));
  } catch (err) {
    console.error("sms inbound failed:", err instanceof Error ? err.message : "unknown error");
    return json(SmsInboundResponse.parse({ ok: false }), 200);
  }
}

/**
 * Numbers the simulator may use: the fictional 555 exchange or area code, like
 * the seeded `+15555550100`. A signed-in student cannot claim a real phone
 * number through `/sms-sim`; real numbers link only by texting the real line.
 */
export const SIM_NUMBER_PATTERN = /^\+1(555\d{7}|\d{3}555\d{4})$/;

export type SimResult =
  | { ok: true; outcome: InboundOutcome; reply?: string }
  | { ok: false; error: string };

/**
 * `/sms-sim` entry. The caller has a verified session (`viewerId`). Replies are
 * always simulated (logged, never sent). A number owned by another student is
 * refused, so the viewer can only talk as themselves or as an unlinked number.
 * Replies stored for the viewer are not echoed back; the page reads them from
 * `sms_messages` with the viewer's own client.
 */
export async function simulateInboundSms(
  input: { viewerId: string; fromNumber: string; content: string },
  deps: Omit<SmsInboundDeps, "provider">,
): Promise<SimResult> {
  const from = normalizePhone(input.fromNumber);
  if (!from || !SIM_NUMBER_PATTERN.test(from)) {
    return { ok: false, error: "Use a 555 test number, for example +15555550100." };
  }
  const content = input.content.trim();
  if (!content || content.length > 1000) {
    return { ok: false, error: "Type a message (up to 1000 characters)." };
  }

  const simDeps: SmsInboundDeps = { ...deps, provider: "simulator" };
  const admin = deps.createAdmin();
  const find = deps.findStudentByPhone ?? defaultFindStudentByPhone;
  const owner = await find(admin, from);
  if (owner && owner.studentId !== input.viewerId) {
    return { ok: false, error: "That number belongs to another student." };
  }

  const result = await processInboundSms(
    // A per-send nonce keeps the same text twice from being treated as a duplicate.
    { from_number: from, content, message_handle: `sim-${crypto.randomUUID()}` },
    { ...simDeps, createAdmin: () => admin },
  );
  if (result.studentId && result.studentId !== input.viewerId) {
    // Not reachable (owner check above), but never echo another student's reply.
    return { ok: true, outcome: result.outcome };
  }
  return { ok: true, outcome: result.outcome, reply: result.studentId ? undefined : result.reply };
}
