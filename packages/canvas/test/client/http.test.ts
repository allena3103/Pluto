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

  it("sleeps for a Retry-After of exactly 60 seconds", async () => {
    const sleeps: number[] = [];
    let call = 0;
    const fetchImpl: typeof fetch = async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ error: "throttled" }), {
          status: 429,
          headers: { "Retry-After": "60" },
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
    expect(sleeps).toEqual([60_000]);
    expect(call).toBe(2);
  });

  it("throws when Retry-After exceeds 60 seconds without sleeping that long", async () => {
    const sleeps: number[] = [];
    let call = 0;
    const fetchImpl: typeof fetch = async () => {
      call += 1;
      return new Response(JSON.stringify({ error: "throttled" }), {
        status: 429,
        headers: { "Retry-After": "3600" },
      });
    };

    let error: unknown;
    try {
      await buildClient(fetchImpl, async (ms) => {
        sleeps.push(ms);
      }).getPaginatedArray({
        path: "/api/v1/courses",
        endpointName: "courses",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CanvasRateLimitError);
    const rateLimit = error as CanvasRateLimitError;
    expect(rateLimit.message).toContain("retry delay exceeded 60 seconds");
    expect(rateLimit.message.includes(TOKEN)).toBe(false);
    expect(call).toBe(1);
    expect(sleeps.some((ms) => ms >= 60_000)).toBe(false);
    expect(sleeps).toEqual([]);
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

  it("does not retry a 200 body that is not valid JSON", async () => {
    let call = 0;
    const sleeps: number[] = [];
    const fetchImpl: typeof fetch = async () => {
      call += 1;
      return new Response("{", { status: 200 });
    };

    let error: unknown;
    try {
      await buildClient(fetchImpl, async (ms) => {
        sleeps.push(ms);
      }).getPaginatedArray({
        path: "/api/v1/courses",
        endpointName: "courses",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CanvasHttpError);
    expect(error).not.toBeInstanceOf(CanvasRateLimitError);
    const httpError = error as CanvasHttpError;
    expect(httpError.status).toBe(200);
    expect(httpError.message).toContain("not valid JSON");
    expect(httpError.message).toContain("200");
    expect(httpError.message.includes("network request failed")).toBe(false);
    expect(httpError.message.includes(TOKEN)).toBe(false);
    expect(call).toBe(1);
    expect(sleeps).toEqual([]);
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

  it("refuses a next link whose origin is not the configured base URL", async () => {
    let call = 0;
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      call += 1;
      seen.push(String(input));
      return new Response(JSON.stringify([{ id: 1 }]), {
        status: 200,
        headers: { Link: `<https://evil.example/steal>; rel="next"` },
      });
    };

    let error: unknown;
    try {
      await buildClient(fetchImpl).getPaginatedArray({
        path: "/api/v1/courses",
        endpointName: "courses",
      });
    } catch (caught) {
      error = caught;
    }

    expect(call).toBe(1);
    expect(seen.some((url) => url.includes("evil.example"))).toBe(false);
    expect(error).toBeInstanceOf(CanvasHttpError);
    const httpError = error as CanvasHttpError;
    expect(httpError.status).toBe(400);
    expect(String(httpError.message).includes(TOKEN)).toBe(false);
    expect(String(httpError.requestPath).includes(TOKEN)).toBe(false);
    expect(String(httpError.message).includes("evil.example")).toBe(false);
    expect(String(httpError.requestPath).includes("evil.example")).toBe(false);
  });

  it("refuses a next link that embeds a username or password", async () => {
    const rejected = "https://user:pass@canvas.local/api/v1/courses?page=2";
    let call = 0;
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      call += 1;
      seen.push(String(input));
      return new Response(JSON.stringify([{ id: 1 }]), {
        status: 200,
        headers: { Link: `<${rejected}>; rel="next"` },
      });
    };

    let error: unknown;
    try {
      await buildClient(fetchImpl).getPaginatedArray({
        path: "/api/v1/courses",
        endpointName: "courses",
      });
    } catch (caught) {
      error = caught;
    }

    expect(call).toBe(1);
    expect(seen.some((url) => url.includes("user:pass"))).toBe(false);
    expect(error).toBeInstanceOf(CanvasHttpError);
    const httpError = error as CanvasHttpError;
    expect(httpError.status).toBe(400);
    expect(String(httpError.message).includes(TOKEN)).toBe(false);
    expect(String(httpError.requestPath).includes(TOKEN)).toBe(false);
    expect(String(httpError.message).includes(rejected)).toBe(false);
    expect(String(httpError.requestPath).includes(rejected)).toBe(false);
    expect(String(httpError.message).includes("user:pass")).toBe(false);
    expect(String(httpError.requestPath).includes("user:pass")).toBe(false);
  });

  it("follows a relative next link on the configured origin", async () => {
    let call = 0;
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      call += 1;
      seen.push(String(input));
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
      const page = new URL(String(input)).searchParams.get("page") ?? "1";
      if (page === "1") {
        return new Response(JSON.stringify([{ id: 1 }]), {
          headers: { Link: `</api/v1/courses?page=2>; rel="next"` },
        });
      }
      return new Response(JSON.stringify([{ id: 2 }]));
    };

    const result = await buildClient(fetchImpl).getPaginatedArray({
      path: "/api/v1/courses",
      endpointName: "courses",
      searchParams: new URLSearchParams({ page: "1" }),
    });

    expect(call).toBe(2);
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    expect(seen.every((url) => new URL(url).origin === BASE_URL)).toBe(true);
  });

  it("refuses next links with a different scheme, port, or subdomain", async () => {
    const links = [
      "http://canvas.local/api/v1/courses?page=2",
      "https://canvas.local:8443/api/v1/courses?page=2",
      "https://files.canvas.local/api/v1/courses?page=2",
    ];

    for (const link of links) {
      let call = 0;
      const fetchImpl: typeof fetch = async (input) => {
        call += 1;
        expect(String(input).includes(link)).toBe(false);
        return new Response(JSON.stringify([{ id: 1 }]), {
          status: 200,
          headers: { Link: `<${link}>; rel="next"` },
        });
      };

      let error: unknown;
      try {
        await buildClient(fetchImpl).getPaginatedArray({
          path: "/api/v1/courses",
          endpointName: "courses",
        });
      } catch (caught) {
        error = caught;
      }

      expect(call).toBe(1);
      expect(error).toBeInstanceOf(CanvasHttpError);
      const httpError = error as CanvasHttpError;
      expect(httpError.status).toBe(400);
      expect(String(httpError.message).includes(TOKEN)).toBe(false);
      expect(String(httpError.requestPath).includes(TOKEN)).toBe(false);
      expect(String(httpError.message).includes(link)).toBe(false);
      expect(String(httpError.requestPath).includes(link)).toBe(false);
    }
  });

  it("does not fetch a first-page URL on another origin", async () => {
    let call = 0;
    const fetchImpl: typeof fetch = async () => {
      call += 1;
      return new Response("[]");
    };

    let error: unknown;
    try {
      await buildClient(fetchImpl).getPaginatedArray({
        path: "https://evil.example/steal",
        endpointName: "courses",
      });
    } catch (caught) {
      error = caught;
    }

    expect(call).toBe(0);
    expect(error).toBeInstanceOf(CanvasHttpError);
    const httpError = error as CanvasHttpError;
    expect(httpError.status).toBe(400);
    expect(String(httpError.message).includes(TOKEN)).toBe(false);
    expect(String(httpError.requestPath).includes(TOKEN)).toBe(false);
    expect(String(httpError.message).includes("evil.example")).toBe(false);
    expect(String(httpError.requestPath).includes("evil.example")).toBe(false);
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
