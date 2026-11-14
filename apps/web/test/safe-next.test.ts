import { describe, expect, test } from "vitest";
import { headersWithPlutoPath, loginRedirectForPath, safeNext } from "../lib/safe-next";

describe("safeNext", () => {
  test("accepts same-origin paths and keeps the query string and hash", () => {
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/chat")).toBe("/chat");
    expect(safeNext("/oauth/consent?authorization_id=abc123")).toBe(
      "/oauth/consent?authorization_id=abc123",
    );
    expect(safeNext("/notes/file-id?page=3#top")).toBe("/notes/file-id?page=3#top");
    expect(safeNext("/notes/my%20file?page=2")).toBe("/notes/my%20file?page=2");
  });

  test("accepts relative paths that resolve on the dummy origin", () => {
    expect(safeNext("./chat")).toBe("/chat");
    expect(safeNext("chat")).toBe("/chat");
    expect(safeNext("../grades")).toBe("/grades");
  });

  test("falls back to / when missing", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext("")).toBe("/");
  });

  test("rejects tab, newline, and CR inside the path", () => {
    expect(safeNext("/\t/evil.example")).toBe("/");
    expect(safeNext("/\n/evil.example")).toBe("/");
    expect(safeNext("/\r/evil.example")).toBe("/");
    expect(safeNext("/\r\n/evil.example")).toBe("/");
    expect(safeNext("/chat\t")).toBe("/");
    expect(safeNext("\t//evil.example")).toBe("/");
  });

  test("rejects absolute URLs with a scheme", () => {
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("http://evil.example/path")).toBe("/");
    expect(safeNext("HTTPS://evil.example")).toBe("/");
  });

  test("rejects protocol-relative paths", () => {
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("///evil.example")).toBe("/");
    expect(safeNext("//evil.example/path")).toBe("/");
  });

  test("rejects backslashes that browsers normalize into a protocol-relative URL", () => {
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("\\\\evil.example")).toBe("/");
    expect(safeNext("/\\/evil.example")).toBe("/");
    expect(safeNext(" /\\evil.example")).toBe("/");
    // A single leading backslash normalizes to a same-origin path, not //.
    expect(safeNext("\\evil.example")).toBe("/evil.example");
  });

  test("rejects javascript and other non-http URLs", () => {
    expect(safeNext("javascript:alert(1)")).toBe("/");
    expect(safeNext("JavaScript:alert(1)")).toBe("/");
    expect(safeNext(" javascript:alert(1)")).toBe("/");
    expect(safeNext("javascript%3Aalert(1)")).toBe("/");
    expect(safeNext("data:text/html,hi")).toBe("/");
  });

  test("rejects encoded controls, slashes, and backslashes", () => {
    expect(safeNext("/%09/evil.example")).toBe("/");
    expect(safeNext("/%0A/evil.example")).toBe("/");
    expect(safeNext("/%0a/evil.example")).toBe("/");
    expect(safeNext("/%0D/evil.example")).toBe("/");
    expect(safeNext("/%0d/evil.example")).toBe("/");
    expect(safeNext("/%2F%2Fevil.example")).toBe("/");
    expect(safeNext("/%2f/%2fevil.example")).toBe("/");
    expect(safeNext("%2F%2Fevil.example")).toBe("/");
    expect(safeNext("/%5Cevil.example")).toBe("/");
    expect(safeNext("/%5C%5Cevil.example")).toBe("/");
    expect(safeNext("%5C%5Cevil.example")).toBe("/");
    expect(safeNext("https%3A%2F%2Fevil.example")).toBe("/");
    expect(safeNext("%2F%09%2Fevil.example")).toBe("/");
  });

  test("rejects a dummy-origin URL whose pathname is protocol-relative", () => {
    expect(safeNext("http://dummy.local//evil.example")).toBe("/");
    expect(safeNext("http://dummy.local/\\evil.example")).toBe("/");
  });
});

describe("loginRedirectForPath", () => {
  test("builds the same login URL the proxy uses for /grades?x=1", () => {
    expect(loginRedirectForPath("/grades?x=1")).toBe("/login?next=%2Fgrades%3Fx%3D1");
    expect(loginRedirectForPath("/")).toBe("/login?next=%2F");
    expect(loginRedirectForPath("/oauth/consent?authorization_id=abc123")).toBe(
      "/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dabc123",
    );
  });

  test("a hostile header value falls back to /", () => {
    expect(loginRedirectForPath("https://evil.example")).toBe("/login?next=%2F");
    expect(loginRedirectForPath("//evil.example")).toBe("/login?next=%2F");
    expect(loginRedirectForPath("/\\evil.example")).toBe("/login?next=%2F");
    expect(loginRedirectForPath("/%09/evil.example")).toBe("/login?next=%2F");
    expect(loginRedirectForPath("https://evil.example, /grades?x=1")).toBe("/login?next=%2F");
    expect(loginRedirectForPath(null)).toBe("/login?next=%2F");
    expect(loginRedirectForPath(undefined)).toBe("/login?next=%2F");
  });
});

describe("headersWithPlutoPath", () => {
  test("overwrites a client-sent x-pluto-path and does not append it", () => {
    const incoming = new Headers();
    incoming.append("x-pluto-path", "https://evil.example");
    incoming.append("x-pluto-path", "//evil.example");
    incoming.set("cookie", "sb=1");

    const headers = headersWithPlutoPath(incoming, "/grades", "?x=1");
    const values: string[] = [];
    headers.forEach((value, key) => {
      if (key === "x-pluto-path") values.push(value);
    });

    expect(values).toEqual(["/grades?x=1"]);
    expect(headers.get("x-pluto-path")).toBe("/grades?x=1");
    expect(headers.get("cookie")).toBe("sb=1");
    expect(loginRedirectForPath(headers.get("x-pluto-path"))).toBe("/login?next=%2Fgrades%3Fx%3D1");
  });
});
