import { createHash, randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@pluto/core/database.types";
import { normalizePhone } from "@pluto/core/sms";

/** How long a freshly minted link code stays usable. */
export const LINK_CODE_TTL_MS = 15 * 60 * 1000;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

/** Six characters from the unambiguous alphabet, after trim and uppercase. */
export const LINK_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export type AdminClient = SupabaseClient<Database>;

export type ConsumeLinkCodeResult =
  | { ok: true; studentId: string }
  | { ok: false; reason: "invalid" | "phone_taken" };

export type IssueLinkCodeResult =
  | { status: 401 }
  | { status: 200; code: string; expiresAt: string };

type LinkCodeRow = {
  id: string;
  student_id: string;
  code_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

/**
 * `phone_link_codes` is absent from `Database` on purpose. This cast is the only
 * place that names the table. `profiles` updates stay on the typed client.
 */
type PhoneLinkDatabase = {
  public: {
    Tables: {
      phone_link_codes: {
        Row: LinkCodeRow;
        Insert: {
          student_id: string;
          code_hash: string;
          expires_at: string;
          used_at?: string | null;
        };
        Update: {
          used_at?: string | null;
          expires_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};

type DbError = { code?: string; message: string };

function codes(admin: AdminClient) {
  return (admin as unknown as SupabaseClient<PhoneLinkDatabase>).from("phone_link_codes");
}

function hashCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

function mintCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET.charAt(randomInt(ALPHABET.length));
  }
  return code;
}

function isUniqueViolation(error: DbError): boolean {
  return error.code === "23505";
}

/**
 * Mint a code for this student. Unused codes for the same student are retired
 * first. The plaintext code is returned once and is never stored.
 */
export async function createLinkCode(
  admin: AdminClient,
  studentId: string,
): Promise<{ code: string; expiresAt: string }> {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + LINK_CODE_TTL_MS).toISOString();

  const { error: retireError } = await codes(admin)
    .update({ used_at: now })
    .eq("student_id", studentId)
    .is("used_at", null);
  if (retireError) {
    throw new Error(`could not retire unused link codes (${retireError.code ?? "error"})`);
  }

  const code = mintCode();
  const { error: insertError } = await codes(admin).insert({
    student_id: studentId,
    code_hash: hashCode(code),
    expires_at: expiresAt,
  });
  if (insertError) {
    throw new Error(`could not create a link code (${insertError.code ?? "error"})`);
  }

  return { code, expiresAt };
}

/**
 * Bind `fromNumber` to the student who owns `rawCode`. Missing, used, expired,
 * and malformed inputs all return `invalid`. A number that already belongs to
 * someone else burns the code and returns `phone_taken` without changing either
 * profile. Replacing this student's own number is allowed.
 */
export async function consumeLinkCode(
  admin: AdminClient,
  rawCode: string,
  fromNumber: string,
): Promise<ConsumeLinkCodeResult> {
  const code = rawCode.trim().toUpperCase();
  if (!LINK_CODE_PATTERN.test(code)) {
    return { ok: false, reason: "invalid" };
  }

  const phone = normalizePhone(fromNumber);
  if (!phone) {
    return { ok: false, reason: "invalid" };
  }

  const now = new Date().toISOString();
  const { data: active, error: lookupError } = await codes(admin)
    .select("id, student_id")
    .eq("code_hash", hashCode(code))
    .is("used_at", null)
    .gt("expires_at", now)
    .maybeSingle();
  if (lookupError) {
    throw new Error(`could not look up a link code (${lookupError.code ?? "error"})`);
  }
  if (!active) {
    return { ok: false, reason: "invalid" };
  }

  const { data: holder, error: holderError } = await admin
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  if (holderError) {
    throw new Error(`could not look up the phone (${holderError.code ?? "error"})`);
  }

  if (holder && holder.id !== active.student_id) {
    const { error: burnError } = await codes(admin)
      .update({ used_at: now })
      .eq("id", active.id)
      .is("used_at", null);
    if (burnError) {
      throw new Error(`could not mark the link code used (${burnError.code ?? "error"})`);
    }
    return { ok: false, reason: "phone_taken" };
  }

  const consumedAt = new Date().toISOString();
  const { data: consumed, error: consumeError } = await codes(admin)
    .update({ used_at: consumedAt })
    .eq("id", active.id)
    .is("used_at", null)
    .gt("expires_at", consumedAt)
    .select("student_id")
    .maybeSingle();
  if (consumeError) {
    throw new Error(`could not mark the link code used (${consumeError.code ?? "error"})`);
  }
  if (!consumed) {
    return { ok: false, reason: "invalid" };
  }

  const { error: phoneError } = await admin.from("profiles").update({ phone }).eq("id", consumed.student_id);
  if (phoneError) {
    if (isUniqueViolation(phoneError)) {
      return { ok: false, reason: "phone_taken" };
    }
    throw new Error(`could not link the phone (${phoneError.code ?? "error"})`);
  }

  return { ok: true, studentId: consumed.student_id };
}

/**
 * Session gate for `POST /api/sms/link-code`. A missing user does not call `create`,
 * so the route can build the service-role client inside that callback.
 */
export async function issueLinkCode(input: {
  userId: string | null;
  create: () => Promise<{ code: string; expiresAt: string }> | { code: string; expiresAt: string };
}): Promise<IssueLinkCodeResult> {
  if (!input.userId) {
    return { status: 401 };
  }
  const issued = await input.create();
  return { status: 200, code: issued.code, expiresAt: issued.expiresAt };
}

/** Rows for one student. Used to prove the raw code is not stored. */
export async function listLinkCodes(
  admin: AdminClient,
  studentId: string,
): Promise<Array<Pick<LinkCodeRow, "code_hash" | "used_at" | "expires_at" | "student_id">>> {
  const { data, error } = await codes(admin)
    .select("code_hash, used_at, expires_at, student_id")
    .eq("student_id", studentId);
  if (error) {
    throw new Error(`could not read link codes (${error.code ?? "error"})`);
  }
  return data ?? [];
}

/** Test hook: move a code's expiry without touching `used_at`. */
export async function setLinkCodeExpiresAt(admin: AdminClient, codeHash: string, expiresAt: string): Promise<void> {
  const { data, error } = await codes(admin)
    .update({ expires_at: expiresAt })
    .eq("code_hash", codeHash)
    .select("id");
  if (error) {
    throw new Error(`could not update the link code (${error.code ?? "error"})`);
  }
  if (!data || data.length === 0) {
    throw new Error("could not update the link code (missing)");
  }
}

/**
 * Select every hash visible to this client. A signed-in student has no grant,
 * so this is an empty list or a permission error, never another student's hash.
 */
export async function selectLinkCodeHashes(client: AdminClient): Promise<{
  data: Array<{ code_hash: string }> | null;
  error: DbError | null;
}> {
  const { data, error } = await codes(client).select("code_hash");
  return {
    data,
    error: error ? { code: error.code, message: error.message } : null,
  };
}
