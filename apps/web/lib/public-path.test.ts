import { describe, expect, it } from "vitest";
import { isPublicPath } from "./public-path";

describe("isPublicPath", () => {
  it("allows auth entry points, API routes, and Next internals", () => {
    for (const path of [
      "/login",
      "/login/callback",
      "/open/abc",
      "/oauth/consent",
      "/.well-known/oauth-authorization-server",
      "/api/ingest",
      "/cal/feed",
      "/auth/confirm",
      "/_next/static/chunks/app.js",
      "/_next/image",
    ]) {
      expect(isPublicPath(path), path).toBe(true);
    }
  });

  it("allows only root-level static files, not the same extension on an app route", () => {
    for (const path of ["/favicon.ico", "/manifest.webmanifest", "/sw.js", "/logo.png", "/mark.svg", "/inter.woff2", "/icon.ICO"]) {
      expect(isPublicPath(path), path).toBe(true);
    }

    for (const path of [
      "/notes/x.png",
      "/notes/abc.woff2",
      "/notes/lecture.svg",
      "/course/week/slide.jpg",
      "/fonts/inter.woff2",
      "/images/logo.png",
      "/notes/x.png/",
      "/logo.png/extra",
      "/..png",
      "/logo%2epng",
      "/notes/%2e%2e/logo.png",
    ]) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });

  it("does not treat a traversal or a signed-in page as public", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/notes/file")).toBe(false);
    expect(isPublicPath("/login/../../notes/x.png")).toBe(false);
    expect(isPublicPath("/_next/static/../notes/x.png")).toBe(false);
  });
});
