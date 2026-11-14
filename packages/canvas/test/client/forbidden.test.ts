import { afterEach, describe, expect, it, vi } from "vitest";
import { createCanvasClient } from "../../src/client";
import { CanvasRateLimitError } from "../../src/types";

const BASE_URL = "https://canvas.local";

function pdfResponse(): Response {
  return new Response(
    JSON.stringify([
      {
        id: "file-1",
        display_name: "notes.pdf",
        filename: "notes.pdf",
        "content-type": "application/pdf",
      },
    ]),
    { status: 200 },
  );
}

describe("canvas files and modules forbidden responses", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the files-disabled warning once and returns an empty list for a plain 403", async () => {
    let call = 0;
    const fetchImpl: typeof fetch = async () => {
      call += 1;
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createCanvasClient({
      baseUrl: BASE_URL,
      token: "canvas-token-DO-NOT-LEAK",
      mode: "live",
      fetch: fetchImpl,
      sleep: async () => {},
    });

    await expect(client.listCourseFiles("42")).resolves.toEqual([]);
    await expect(client.listCourseFiles("42")).resolves.toEqual([]);

    expect(call).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "Canvas files disabled for /api/v1/courses/42/files; treating as empty.",
    );
  });

  it("returns an empty module list for a plain 403 without the files warning", async () => {
    let call = 0;
    const fetchImpl: typeof fetch = async () => {
      call += 1;
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createCanvasClient({
      baseUrl: BASE_URL,
      token: "canvas-token-DO-NOT-LEAK",
      mode: "live",
      fetch: fetchImpl,
      sleep: async () => {},
    });

    await expect(client.listModuleItems("42")).resolves.toEqual([]);
    expect(call).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("retries a rate-limit 403 on files and does not treat it as files disabled", async () => {
    let call = 0;
    const sleeps: number[] = [];
    const fetchImpl: typeof fetch = async () => {
      call += 1;
      if (call === 1) {
        return new Response("403 Forbidden (Rate Limit Exceeded)", { status: 403 });
      }
      return pdfResponse();
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createCanvasClient({
      baseUrl: BASE_URL,
      token: "canvas-token-DO-NOT-LEAK",
      mode: "live",
      fetch: fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const files = await client.listCourseFiles("42");
    expect(files.map((file) => file.canvasFileId)).toEqual(["file-1"]);
    expect(call).toBe(2);
    expect(sleeps.length).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not treat a persistent rate-limit 403 as files disabled", async () => {
    let call = 0;
    const fetchImpl: typeof fetch = async () => {
      call += 1;
      return new Response("403 Forbidden (Rate Limit Exceeded)", { status: 403 });
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createCanvasClient({
      baseUrl: BASE_URL,
      token: "canvas-token-DO-NOT-LEAK",
      mode: "live",
      fetch: fetchImpl,
      sleep: async () => {},
    });

    await expect(client.listCourseFiles("42")).rejects.toBeInstanceOf(CanvasRateLimitError);
    expect(call).toBe(4);
    expect(warn).not.toHaveBeenCalled();
  });
});
