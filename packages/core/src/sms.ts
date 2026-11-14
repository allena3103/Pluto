import type { PlutoDb } from "./context";

const SENDBLUE_SEND_MESSAGE_URL = "https://api.sendblue.co/api/send-message";
const SENDBLUE_TIMEOUT_MS = 10_000;

export type SmsProvider = "simulator" | "sendblue";

export interface SmsDeps {
  admin: PlutoDb;
  provider?: SmsProvider;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

export interface SendSmsInput {
  studentId: string;
  to: string;
  body: string;
}

export type SendSmsResult =
  | { ok: true; provider: SmsProvider; id: string }
  | { ok: false; provider: SmsProvider; error: string };

function providerFrom(deps: SmsDeps): SmsProvider {
  const fromEnv = deps.env?.SMS_PROVIDER;
  return deps.provider ?? (fromEnv === "sendblue" ? "sendblue" : "simulator");
}

async function insertOutbound(
  admin: PlutoDb,
  input: { studentId: string; to: string; body: string; provider: SmsProvider },
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await admin
    .from("sms_messages")
    .insert({
      student_id: input.studentId,
      direction: "outbound",
      body: input.body,
      phone: input.to,
      provider: input.provider,
    })
    .select("id")
    .single();
  if (error || !data) return { error: `failed to log outbound message: ${error?.message ?? "no row returned"}` };
  return { id: data.id };
}

function shortError(error: unknown): string {
  if (error instanceof Error) return error.name === "TimeoutError" ? "request timed out" : error.message;
  return "request failed";
}

// Sendblue request shape verified against:
// https://www.sendblue.com/api and https://docs.sendblue.com/getting-started/sending-messages/
async function sendWithSendblue(
  fetchImpl: typeof fetch,
  env: NodeJS.ProcessEnv,
  input: SendSmsInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const keyId = env.SENDBLUE_API_KEY_ID;
  const secretKey = env.SENDBLUE_API_SECRET;
  const fromNumber = env.SENDBLUE_FROM_NUMBER;
  if (!keyId || !secretKey || !fromNumber) {
    return { ok: false, error: "missing Sendblue env: SENDBLUE_API_KEY_ID, SENDBLUE_API_SECRET, SENDBLUE_FROM_NUMBER" };
  }

  try {
    const response = await fetchImpl(SENDBLUE_SEND_MESSAGE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sb-api-key-id": keyId,
        "sb-api-secret-key": secretKey,
      },
      body: JSON.stringify({
        number: input.to,
        from_number: fromNumber,
        content: input.body,
      }),
      signal: AbortSignal.timeout(SENDBLUE_TIMEOUT_MS),
    });

    if (!response.ok) {
      return { ok: false, error: `Sendblue request failed (${response.status})` };
    }

    const payload = (await response.json().catch(() => null)) as { id?: string; message_handle?: string } | null;
    return { ok: true, id: payload?.id ?? payload?.message_handle ?? `sendblue-${Date.now()}` };
  } catch (error) {
    return { ok: false, error: shortError(error) };
  }
}

export async function sendSms(deps: SmsDeps, input: SendSmsInput): Promise<SendSmsResult> {
  const provider = providerFrom(deps);
  if (!input.studentId) throw new TypeError("studentId is required");
  if (!input.to) throw new TypeError("to is required");
  if (!input.body) throw new TypeError("body is required");

  if (provider === "simulator") {
    const logged = await insertOutbound(deps.admin, { studentId: input.studentId, to: input.to, body: input.body, provider });
    return "error" in logged ? { ok: false, provider, error: logged.error } : { ok: true, provider, id: logged.id };
  }

  const sendResult = await sendWithSendblue(deps.fetch ?? fetch, deps.env ?? process.env, input);
  const logged = await insertOutbound(deps.admin, { studentId: input.studentId, to: input.to, body: input.body, provider });
  if ("error" in logged) return { ok: false, provider, error: logged.error };
  if (!sendResult.ok) return { ok: false, provider, error: sendResult.error };
  return { ok: true, provider, id: sendResult.id || logged.id };
}

export async function recordInboundSms(
  admin: PlutoDb,
  input: { studentId: string; from: string; body: string; provider: string },
): Promise<void> {
  const { error } = await admin.from("sms_messages").insert({
    student_id: input.studentId,
    direction: "inbound",
    body: input.body,
    phone: input.from,
    provider: input.provider,
  });
  if (error) throw new Error(`failed to record inbound sms: ${error.message}`);
}

export function normalizePhone(phone: string): string | null {
  const trimmed = phone.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/[^\d]/g, "");
    const normalized = `+${digits}`;
    return /^\+[1-9]\d{6,14}$/.test(normalized) ? normalized : null;
  }

  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 0) {
    const normalized = `+${digits}`;
    return /^\+[1-9]\d{6,14}$/.test(normalized) ? normalized : null;
  }
  return null;
}

export async function findStudentByPhone(admin: PlutoDb, phone: string): Promise<{ studentId: string; name: string } | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const { data, error } = await admin.from("profiles").select("id,name").eq("phone", normalized).maybeSingle();
  if (error) throw new Error(`failed to find student by phone: ${error.message}`);
  if (!data) return null;
  return { studentId: data.id, name: data.name ?? "" };
}
