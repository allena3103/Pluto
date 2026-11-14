import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const TOKEN_VERSION = "v1";
const TOKEN_PARTS = 4;
const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;

export const CANVAS_TOKEN_KEY_BYTES = 32;

function resolveKeyMaterial(keyB64?: string): Buffer {
  const source = keyB64 ?? process.env.CANVAS_TOKEN_KEY;
  if (!source) {
    throw new Error("CANVAS_TOKEN_KEY is required");
  }

  const decoded = Buffer.from(source, "base64");
  if (decoded.length !== CANVAS_TOKEN_KEY_BYTES) {
    throw new Error(`CANVAS_TOKEN_KEY must decode to ${CANVAS_TOKEN_KEY_BYTES} bytes`);
  }

  return decoded;
}

function toBase64Url(value: Buffer): string {
  return value.toString("base64url");
}

function parseBase64Url(part: string, label: string): Buffer {
  if (!part || !BASE64URL_SEGMENT.test(part)) {
    throw new Error(`Invalid encrypted token format (${label})`);
  }

  return Buffer.from(part, "base64url");
}

export function isEncryptedCanvasToken(value: string): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== TOKEN_PARTS || parts[0] !== TOKEN_VERSION) return false;
  return parts.slice(1).every((part) => Boolean(part) && BASE64URL_SEGMENT.test(part));
}

export function encryptCanvasToken(plaintext: string, keyB64?: string): string {
  const key = resolveKeyMaterial(keyB64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${TOKEN_VERSION}.${toBase64Url(iv)}.${toBase64Url(authTag)}.${toBase64Url(ciphertext)}`;
}

export function decryptCanvasToken(payload: string, keyB64?: string): string {
  if (!isEncryptedCanvasToken(payload)) {
    throw new Error("Invalid encrypted token format");
  }

  const parts = payload.split(".");
  const version = parts[0];
  const ivPart = parts[1];
  const tagPart = parts[2];
  const ciphertextPart = parts[3];

  if (!version || !ivPart || !tagPart || !ciphertextPart) {
    throw new Error("Invalid encrypted token format");
  }

  if (version !== TOKEN_VERSION) {
    throw new Error("Invalid encrypted token version");
  }

  const iv = parseBase64Url(ivPart, "iv");
  const authTag = parseBase64Url(tagPart, "tag");
  const ciphertext = parseBase64Url(ciphertextPart, "ciphertext");

  if (iv.length !== IV_BYTES) {
    throw new Error("Invalid encrypted token format (iv length)");
  }

  if (authTag.length !== GCM_TAG_BYTES) {
    throw new Error("Invalid encrypted token format (tag length)");
  }

  const key = resolveKeyMaterial(keyB64);

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    throw new Error("Failed to decrypt Canvas token");
  }
}
