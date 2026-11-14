import { describe, expect, it } from "vitest";
import { createCanvasHttpClient } from "../../src/http";
import {
  CanvasAuthError,
  CanvasHttpError,
  CanvasRateLimitError,
  CanvasTimeoutError,
} from "../../src/types";

const BASE_URL = "https://canvas.local";
const TOKEN = "canvas-token-DO-NOT-LEAK";

function buildClient(fetchImpl: typeof fetch, sleep?: (ms: number) => Promise<void>) {
  return createCanvasHttpClient({
    baseUrl: BASE_URL,
    token: TOKEN,
    includeAuthHeader: true,
    fetchImpl,
    sleep,
    timeoutMs: 10,
    maxPages: 3,
  });
}

describe("canvas http client", () => {
  it("follows three pages from link headers in order", async () => {
    let call = 0;
    const fetchImpl: typeof fetch = async (input) => {
      call += 1;
      const url = new URL(String(input));
      const page = url.searchParams.get("page") ?? "1";
      if (page === "1") {
        return new Response(JSON.stringify([{ id: 1 }]), {
          headers: { Link: `<${BASE_URL}/api/v1/courses?page=2>; rel="next"` },
        });
      }
      if (page === "2") {
        return new Response(JSON.stringify([{ id: 2 }]), {
          headers: { Link: `<${BASE_URL}/api/v1/courses?page=3>; rel="next"` },
        });
      }
      return new Response(JSON.stringify([{ id: 3 }]));
    };

    const result = await buildClient(fetchImpl).getPaginatedArray({
      path: "/api/v1/courses",
      endpointName: "courses",
      searchParams: new URLSearchParams({ page: "1" }),
    });

    expect(call).toBe(3);
    expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it("throws when pagination exceeds maxPages", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("page") ?? "1");
      return new Response(JSON.stringify([{ page }]), {
        headers: { Link: `<${BASE_URL}/api/v1/courses?page=${page + 1}>; rel="next"` },
      });
    };

    const client = buildClient(fetchImpl);
    await expect(
      client.getPaginatedArray({
        path: "/api/v1/courses",
        endpointName: "courses",
        searchParams: new URLSearchParams({ page: "1" }),
      }),
    ).rejects.toBeInstanceOf(CanvasHttpError);
  });

  it("retries 429 with retry-after and succeeds", async () => {
    const sleeps: number[] = [];
    let call = 0;
    const fetchImpl: typeof fetch = async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ error: "throttled" }), {
          status: 429,
          headers: { "Retry-After": "1" },
        });
      }
      return new Response(JSON.stringify([{ id: "ok" }]), { status: 200 });
    };

    const result = await buildClient(fetchImpl, async (ms) => {
      sleeps.push(ms);
    }).getPaginatedArray({
      path: "/api/v1/courses",
      endpointName: "courses",
    });

    expect(result).toEqual([{ id: "ok" }]);
    expect(sleeps).toEqual([1000]);
    expect(call).toBe(2);
  });

  it("retries 403 with rate limit body but not plain 403", async () => {
    let call = 0;
    const retryFetch: typeof fetch = async () => {
      call += 1;
      if (call === 1) {
        return new Response("403 Forbidden (Rate Limit Exceeded)", { status: 403 });
      }
      return new Response(JSON.stringify([{ id: "ok" }]));
    };

    const ok = await buildClient(retryFetch, async () => {}).getPaginatedArray({
      path: "/api/v1/courses",
      endpointName: "courses",
    });
    expect(ok).toEqual([{ id: "ok" }]);
    expect(call).toBe(2);

    const forbiddenFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    await expect(
      buildClient(forbiddenFetch).getPaginatedArray({
        path: "/api/v1/courses",
        endpointName: "courses",
      }),
    ).rejects.toBeInstanceOf(CanvasHttpError);
  });

  it("retries timeout abort errors and throws CanvasTimeoutError", async () => {
    let call = 0;
    const fetchImpl: typeof fetch = async () => {
      call += 1;
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    };

    await expect(
      buildClient(fetchImpl, async () => {}).getPaginatedArray({
        path: "/api/v1/courses",
        endpointName: "courses",
      }),
    ).rejects.toBeInstanceOf(CanvasTimeoutError);
    expect(call).toBe(4);
  });

  it("throws CanvasAuthError on 401 without retry", async () => {
    let call = 0;
    const fetchImpl: typeof fetch = async () => {
      call += 1;
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    };

    await expect(
      buildClient(fetchImpl).getPaginatedArray({
        path: "/api/v1/courses",
        endpointName: "courses",
      }),
    ).rejects.toBeInstanceOf(CanvasAuthError);
    expect(call).toBe(1);
  });

  it("treats empty body, null body, and [] as empty arrays", async () => {
    const cases = ["", "null", "[]"];
    for (const body of cases) {
      const fetchImpl: typeof fetch = async () => new Response(body, { status: 200 });
      const result = await buildClient(fetchImpl).getPaginatedArray({
        path: "/api/v1/courses",
        endpointName: "courses",
      });
      expect(result).toEqual([]);
    }
  });

  it("never leaks token in thrown errors", async () => {
    const fetchImpl: typeof fetch = async () => new Response("retry", { status: 429 });

    try {
      await buildClient(fetchImpl, async () => {}).getPaginatedArray({
        path: "/api/v1/courses",
        endpointName: "courses",
      });
      throw new Error("expected CanvasRateLimitError");
    } catch (error) {
      expect(error).toBeInstanceOf(CanvasRateLimitError);
      const err = error as Error & { toJSON?: () => unknown };
      expect(err.message.includes(TOKEN)).toBe(false);
      expect((err.stack ?? "").includes(TOKEN)).toBe(false);
      const json = typeof err.toJSON === "function" ? JSON.stringify(err.toJSON()) : JSON.stringify(err);
      expect(json.includes(TOKEN)).toBe(false);
    }
  });
});
