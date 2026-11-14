import { afterEach, describe, expect, it } from "vitest";
import {
  CANVAS_TOKEN_KEY_BYTES,
  decryptCanvasToken,
  encryptCanvasToken,
  isEncryptedCanvasToken,
} from "../../src/token-crypto";

const TEST_TOKEN = "canvas-token-DO-NOT-LEAK";
const GOOD_KEY = Buffer.alloc(CANVAS_TOKEN_KEY_BYTES, 7).toString("base64");
const WRONG_KEY = Buffer.alloc(CANVAS_TOKEN_KEY_BYTES, 9).toString("base64");
const BAD_KEY = Buffer.alloc(16, 3).toString("base64");

const originalEnvKey = process.env.CANVAS_TOKEN_KEY;

function flipByteInPayloadPart(payload: string, partIndex: 2 | 3): string {
  const parts = payload.split(".");
  const buffer = Buffer.from(parts[partIndex] ?? "", "base64url");
  buffer[0] = (buffer[0] ?? 0) ^ 0xff;
  parts[partIndex] = buffer.toString("base64url");
  return parts.join(".");
}

afterEach(() => {
  if (originalEnvKey === undefined) {
    delete process.env.CANVAS_TOKEN_KEY;
    return;
  }
  process.env.CANVAS_TOKEN_KEY = originalEnvKey;
});

describe("token-crypto", () => {
  it("round-trips a token", () => {
    const encrypted = encryptCanvasToken(TEST_TOKEN, GOOD_KEY);
    const decrypted = decryptCanvasToken(encrypted, GOOD_KEY);
    expect(decrypted).toBe(TEST_TOKEN);
  });

  it("uses a random IV so encrypting the same token differs", () => {
    const first = encryptCanvasToken(TEST_TOKEN, GOOD_KEY);
    const second = encryptCanvasToken(TEST_TOKEN, GOOD_KEY);
    expect(first).not.toBe(second);
  });

  it("fails decryption with the wrong key", () => {
    const encrypted = encryptCanvasToken(TEST_TOKEN, GOOD_KEY);
    expect(() => decryptCanvasToken(encrypted, WRONG_KEY)).toThrow("Failed to decrypt Canvas token");
  });

  it("fails decryption when ciphertext is tampered", () => {
    const encrypted = encryptCanvasToken(TEST_TOKEN, GOOD_KEY);
    const tampered = flipByteInPayloadPart(encrypted, 3);
    expect(() => decryptCanvasToken(tampered, GOOD_KEY)).toThrow("Failed to decrypt Canvas token");
  });

  it("fails decryption when auth tag is tampered", () => {
    const encrypted = encryptCanvasToken(TEST_TOKEN, GOOD_KEY);
    const tampered = flipByteInPayloadPart(encrypted, 2);
    expect(() => decryptCanvasToken(tampered, GOOD_KEY)).toThrow("Failed to decrypt Canvas token");
  });

  it("throws on invalid key length", () => {
    expect(() => encryptCanvasToken(TEST_TOKEN, BAD_KEY)).toThrow("CANVAS_TOKEN_KEY must decode to 32 bytes");
  });

  it("throws when CANVAS_TOKEN_KEY is missing", () => {
    delete process.env.CANVAS_TOKEN_KEY;
    expect(() => encryptCanvasToken(TEST_TOKEN)).toThrow("CANVAS_TOKEN_KEY is required");
  });

  it("checks encrypted payload shape", () => {
    const encrypted = encryptCanvasToken(TEST_TOKEN, GOOD_KEY);
    expect(isEncryptedCanvasToken(encrypted)).toBe(true);
    expect(isEncryptedCanvasToken(TEST_TOKEN)).toBe(false);
  });

  it("does not leak token or key text in thrown errors", () => {
    const encrypted = encryptCanvasToken(TEST_TOKEN, GOOD_KEY);
    const tampered = flipByteInPayloadPart(encrypted, 3);
    let message = "";
    try {
      decryptCanvasToken(tampered, WRONG_KEY);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain(TEST_TOKEN);
    expect(message).not.toContain(GOOD_KEY);
    expect(message).not.toContain(WRONG_KEY);
  });
});
