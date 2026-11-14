import { afterEach, describe, expect, test, vi } from "vitest";

// getClaims is mocked here so claim checks run on a signature-valid claim set
// (the local stack is HS256 and its JWT secret is not in env, so an expired
// token cannot be signed for real). The real verifier runs in oauth.db.test.ts.
const getClaims = vi.fn();
vi.mock("@supabase/supabase-js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/supabase-js")>();
  return {
    ...actual,
    createClient: (...args: Parameters<typeof actual.createClient>) => {
      const client = actual.createClient(...args);
      Object.defineProperty(client.auth, "getClaims", { value: getClaims });
      return client;
    },
  };
});

const { authenticate, studentIdFromClaims } = await import("../src/auth");
const { CHALLENGE, INVALID_CHALLENGE, postMcp, rpcBody, unitConfig } = await import("./request");

const SUB = "33333333-3333-4333-8333-333333333333";
const ISS = "http://127.0.0.1:9/auth/v1";
// Shape of a JWT only; getClaims is mocked so the content is never trusted.
const JWT_SHAPED = "aaaa.bbbb.cccc";

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: SUB,
    role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 600,
    iss: ISS,
    ...overrides,
  };
}

function request(authorization: string): Request {
  return new Request("http://127.0.0.1:3301/api/mcp", { method: "POST", headers: { authorization } });
}

afterEach(() => {
  getClaims.mockReset();
});

describe("supabase access token claims", () => {
  test("valid claims map to sub with the oauth method", async () => {
    getClaims.mockResolvedValue({ data: { claims: claims() }, error: null });
    const result = await authenticate(request(`Bearer ${JWT_SHAPED}`), unitConfig());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.method).toBe("oauth");
    expect(result.studentId).toBe(SUB);
    expect(getClaims).toHaveBeenCalledWith(JWT_SHAPED);
  });

  test("expired, wrong role, foreign issuer, bad sub, or a verifier error is a 401 with invalid_token", async () => {
    const bad: Array<{ data: unknown; error: unknown }> = [
      { data: { claims: claims({ exp: Math.floor(Date.now() / 1000) - 1 }) }, error: null },
      { data: { claims: claims({ exp: undefined }) }, error: null },
      { data: { claims: claims({ role: "anon" }) }, error: null },
      { data: { claims: claims({ role: "service_role" }) }, error: null },
      { data: { claims: claims({ iss: "https://evil.example/auth/v1" }) }, error: null },
      { data: { claims: claims({ iss: `${ISS}/` }) }, error: null },
      { data: { claims: claims({ sub: undefined }) }, error: null },
      { data: { claims: claims({ sub: "not-a-uuid" }) }, error: null },
      { data: null, error: new Error("invalid signature") },
    ];
    for (const value of bad) {
      getClaims.mockResolvedValueOnce(value);
      const response = await postMcp(unitConfig({ demoToken: undefined }), rpcBody("tools/list", {}), `Bearer ${JWT_SHAPED}`);
      expect(response.status, JSON.stringify(value)).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(INVALID_CHALLENGE);
    }
  });

  test("a thrown verifier error is rejected without leaking", async () => {
    getClaims.mockRejectedValueOnce(new Error("boom"));
    const result = await authenticate(request(`Bearer ${JWT_SHAPED}`), unitConfig());
    expect(result).toEqual({ ok: false, reason: "unauthorized", tokenRejected: true });
  });

  test("non-JWT bearers never reach the verifier; no bearer is a plain challenge", async () => {
    const result = await authenticate(request("Bearer not-a-jwt"), unitConfig());
    expect(result.ok).toBe(false);
    expect(getClaims).not.toHaveBeenCalled();

    const response = await postMcp(unitConfig(), rpcBody("tools/list", {}));
    expect(response.headers.get("www-authenticate")).toBe(CHALLENGE);
    expect(getClaims).not.toHaveBeenCalled();
  });

  test("studentIdFromClaims checks exp against the given clock", () => {
    const config = unitConfig();
    const exp = 2_000_000_000;
    expect(studentIdFromClaims(claims({ exp }), config, exp * 1000 - 1)).toBe(SUB);
    expect(studentIdFromClaims(claims({ exp }), config, exp * 1000)).toBeUndefined();
  });
});
