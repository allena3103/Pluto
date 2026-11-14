import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { CLEAR_CACHES_TYPE as CLIENT_CLEAR, PLUTO_CACHE_PREFIX as CLIENT_PREFIX } from "../lib/clear-pluto-caches";
import {
  CACHE_VERSION,
  CLEAR_CACHES_TYPE,
  OFFLINE_URL,
  PLUTO_CACHE_PREFIX,
  PRECACHE_URLS,
  hasRscHeader,
  plutoCacheNames,
  shouldCacheRequest,
  type SwRequestLike,
} from "../public/sw.js";

const ORIGIN = "http://pluto.test";

function headers(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name: string) => map.get(name.toLowerCase()) ?? null };
}

function decide(
  href: string,
  extra: { method?: string; mode?: string; headers?: Record<string, string> } = {},
): boolean {
  const request: SwRequestLike = {
    method: extra.method ?? "GET",
    mode: extra.mode ?? "same-origin",
    headers: headers(extra.headers),
  };
  return shouldCacheRequest(new URL(href, ORIGIN), request, ORIGIN);
}

describe("service worker cache policy", () => {
  test("bumps the cache version and precaches only static files", () => {
    expect(CACHE_VERSION).toBe("pluto-static-v2");
    expect(CACHE_VERSION.startsWith(PLUTO_CACHE_PREFIX)).toBe(true);
    expect(PRECACHE_URLS).toEqual([OFFLINE_URL, "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"]);
    expect(PRECACHE_URLS).not.toContain("/");
    expect(CLEAR_CACHES_TYPE).toBe(CLIENT_CLEAR);
    expect(PLUTO_CACHE_PREFIX).toBe(CLIENT_PREFIX);
  });

  test("the offline page has no personal data", () => {
    const html = readFileSync(fileURLToPath(new URL("../public/offline.html", import.meta.url)), "utf8");
    expect(html).toContain("You're offline");
    expect(html.toLowerCase()).not.toContain("profile");
    expect(html.toLowerCase()).not.toContain("email");
    expect(html.toLowerCase()).not.toContain("student");
    expect(html).not.toContain("Welcome");
  });

  test("caches static assets and nothing with a query, RSC header, or navigation mode", () => {
    expect(decide("/_next/static/chunks/app.js")).toBe(true);
    expect(decide("/_next/static/media/font.woff2")).toBe(true);
    expect(decide("/icon-192.png")).toBe(true);
    expect(decide("/icon-512.png")).toBe(true);
    expect(decide("/manifest.webmanifest")).toBe(true);
    expect(decide("/offline.html")).toBe(true);

    expect(decide("/_next/static/chunks/app.js?v=1")).toBe(false);
    expect(decide("/icon-192.png?x=1")).toBe(false);
    expect(decide("/?_rsc=abc")).toBe(false);
    expect(decide("/chat?_rsc=abc")).toBe(false);
    expect(decide("/", { headers: { RSC: "1" } })).toBe(false);
    expect(decide("/_next/static/chunks/app.js", { headers: { RSC: "1" } })).toBe(false);
    expect(decide("/chat", { headers: { "Next-Router-Prefetch": "1" } })).toBe(false);
    expect(decide("/chat", { headers: { "Next-Router-Segment-Prefetch": "/chat" } })).toBe(false);
    expect(decide("/", { mode: "navigate" })).toBe(false);
    expect(decide("/chat", { mode: "navigate" })).toBe(false);
    expect(decide("/offline.html", { mode: "navigate" })).toBe(false);
    expect(decide("/_next/static/chunks/app.js", { mode: "navigate" })).toBe(false);
  });

  test("never caches authenticated pages, APIs, or other origins", () => {
    expect(decide("/")).toBe(false);
    expect(decide("/chat")).toBe(false);
    expect(decide("/notes/file")).toBe(false);
    expect(decide("/grades")).toBe(false);
    expect(decide("/login")).toBe(false);
    expect(decide("/api/chat")).toBe(false);
    expect(decide("/open/token")).toBe(false);
    expect(decide("/_next/image")).toBe(false);
    expect(decide("http://evil.example/_next/static/chunks/app.js")).toBe(false);
    expect(decide("/icon-192.png", { method: "POST" })).toBe(false);
  });

  test("treats an RSC header as present for any non-null value", () => {
    expect(hasRscHeader(headers())).toBe(false);
    expect(hasRscHeader(headers({ RSC: "1" }))).toBe(true);
    expect(hasRscHeader(undefined)).toBe(false);
  });

  test("names every Pluto cache so sign-out can delete old shell caches", () => {
    expect(plutoCacheNames(["pluto-shell-v1", "other-app", "pluto-static-v2"])).toEqual([
      "pluto-shell-v1",
      "pluto-static-v2",
    ]);
  });
});
