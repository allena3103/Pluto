import { describe, expect, test } from "vitest";
import { safeNext } from "../lib/safe-next";

describe("safeNext", () => {
  test("accepts a same-origin path and keeps its query string", () => {
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/chat")).toBe("/chat");
    expect(safeNext("/oauth/consent?authorization_id=abc123")).toBe(
      "/oauth/consent?authorization_id=abc123",
    );
  });

  test("falls back to / when missing", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext("")).toBe("/");
  });

  test("rejects absolute URLs with a scheme", () => {
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("http://evil.example/path")).toBe("/");
  });

  test("rejects protocol-relative paths", () => {
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("///evil.example")).toBe("/");
  });

  test("rejects a leading backslash (browser-normalized to //)", () => {
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("\\evil.example")).toBe("/");
  });

  test("rejects paths with no leading slash", () => {
    expect(safeNext("evil.example")).toBe("/");
    expect(safeNext("javascript:alert(1)")).toBe("/");
  });
});
