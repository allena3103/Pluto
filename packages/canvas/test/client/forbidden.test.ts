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

  it("warns once and returns an empty list when both files and modules are 403", async () => {
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

    expect(call).toBe(4); // files + modules, twice
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "Canvas files tab hidden for /api/v1/courses/42/files; reading files from modules.",
    );
  });

  it("reads PDFs linked from modules when the Files tab is hidden", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const requested: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      requested.push(url.pathname);
      if (url.pathname === "/api/v1/courses/42/files") return new Response("{}", { status: 403 });
      if (url.pathname === "/api/v1/courses/42/modules") {
        return new Response(
          JSON.stringify([
            {
              name: "Chapter 4",
              items: [
                { type: "File", content_id: 7 },
                { type: "File", content_id: 8 },
                { type: "File", content_id: 9 },
                { type: "File", content_id: 7 },
                { type: "Page", content_id: 1 },
              ],
            },
          ]),
          { status: 200 },
        );
      }
      if (url.pathname === "/api/v1/courses/42/files/7") {
        return new Response(
          JSON.stringify({ id: 7, display_name: "Ch4 slides", "content-type": "application/pdf", url: `${BASE_URL}/files/7/download` }),
          { status: 200 },
        );
      }
      if (url.pathname === "/api/v1/courses/42/files/8") {
        return new Response(JSON.stringify({ id: 8, display_name: "Ch4 data.xlsx", "content-type": "application/vnd.ms-excel" }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 404 }); // file 9 is locked or unpublished
    };
    const client = createCanvasClient({ baseUrl: BASE_URL, token: "t", mode: "live", fetch: fetchImpl, sleep: async () => {} });

    const files = await client.listCourseFiles("42");
    expect(files.map((f) => [f.canvasFileId, f.title])).toEqual([["7", "Ch4 slides"]]);
    expect(requested.filter((p) => p === "/api/v1/courses/42/files/7")).toHaveLength(1);
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
