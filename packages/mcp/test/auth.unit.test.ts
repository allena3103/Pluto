import { describe, expect, test } from "vitest";
import { authenticate, digestEqual } from "../src/auth";
import { UNIT_TOKEN, unitConfig } from "./request";

const studentId = "22222222-2222-4222-8222-222222222222";

function request(authorization?: string, url = "http://127.0.0.1:3301/api/mcp"): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request(url, { method: "POST", headers });
}

describe("demo token comparison", () => {
  test("equal strings match and unequal strings do not, including different lengths", () => {
    expect(digestEqual("same-token", "same-token")).toBe(true);
    expect(digestEqual("same-token", "other-token")).toBe(false);
    expect(digestEqual("short", "a-much-longer-token-value")).toBe(false);
    expect(digestEqual("", UNIT_TOKEN)).toBe(false);
  });

  test("a matching bearer of at least 24 characters maps to the configured student", () => {
    const result = authenticate(request(`Bearer ${UNIT_TOKEN}`), unitConfig({ demoStudentId: studentId }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.method).toBe("demo");
    expect(result.studentId).toBe(studentId);
    expect(result.db).toBeDefined();
  });

  test("wrong token, missing header, Basic, unset demo token, and a short demo token are unauthorized", () => {
    const enabled = unitConfig();
    expect(authenticate(request(`Bearer ${"x".repeat(32)}`), enabled).ok).toBe(false);
    expect(authenticate(request(), enabled).ok).toBe(false);
    expect(authenticate(request("Basic cGx1dG8="), enabled).ok).toBe(false);

    const unset = unitConfig({ demoToken: undefined });
    expect(authenticate(request(`Bearer ${UNIT_TOKEN}`), unset).ok).toBe(false);

    const short = "short-token";
    const disabled = unitConfig({ demoToken: short });
    expect(authenticate(request(`Bearer ${short}`), disabled).ok).toBe(false);
  });

  test("query string and cookie tokens are ignored", () => {
    const url = `http://127.0.0.1:3301/api/mcp?token=${UNIT_TOKEN}`;
    const headers = new Headers({ cookie: `token=${UNIT_TOKEN}` });
    const result = authenticate(new Request(url, { method: "POST", headers }), unitConfig());
    expect(result.ok).toBe(false);
  });

  test("a bearer token still matches when the url also carries a token query", () => {
    const url = `http://127.0.0.1:3301/api/mcp?access_token=nope`;
    const result = authenticate(request(`Bearer ${UNIT_TOKEN}`, url), unitConfig());
    expect(result.ok).toBe(true);
  });
});
