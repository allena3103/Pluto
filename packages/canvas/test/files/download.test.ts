import { describe, expect, it } from "vitest";
import { downloadPdf, FILE_DOWNLOAD_MAX_BYTES } from "../../src/files-sync";

const TOKEN = "canvas-download-test-token-DO-NOT-LEAK";
const BASE = "https://school.instructure.com";
const PDF = new TextEncoder().encode("%PDF-1.4\nfake\n%%EOF");

type Call = { url: string; authorization: string | null };

function recordingFetch(respond: (url: URL) => Response): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url: url.toString(), authorization: new Headers(init?.headers).get("authorization") });
    return respond(url);
  };
  return { fetch: impl, calls };
}

const pdfResponse = () => new Response(PDF, { status: 200, headers: { "content-type": "application/pdf" } });

describe("downloadPdf", () => {
  it("sends the token only to the configured Canvas host", async () => {
    const { fetch, calls } = recordingFetch(() => pdfResponse());
    await downloadPdf(`${BASE}/files/1/download?verifier=abc`, { baseUrl: BASE, token: TOKEN, fetch });
    await downloadPdf("https://cdn.example.com/files/1.pdf", { baseUrl: BASE, token: TOKEN, fetch });
    await downloadPdf("https://school.instructure.com.evil.test/files/1.pdf", { baseUrl: BASE, token: TOKEN, fetch });
    expect(calls.map((call) => call.authorization)).toEqual([`Bearer ${TOKEN}`, null, null]);
  });

  it("drops the token when Canvas redirects to another host", async () => {
    const { fetch, calls } = recordingFetch((url) =>
      url.host === "school.instructure.com"
        ? new Response(null, { status: 302, headers: { location: "https://bucket.s3.amazonaws.com/signed?x=1" } })
        : pdfResponse(),
    );
    const bytes = await downloadPdf(`${BASE}/files/1/download`, { baseUrl: BASE, token: TOKEN, fetch });
    expect(bytes.byteLength).toBe(PDF.byteLength);
    expect(calls).toEqual([
      { url: `${BASE}/files/1/download`, authorization: `Bearer ${TOKEN}` },
      { url: "https://bucket.s3.amazonaws.com/signed?x=1", authorization: null },
    ]);
  });

  it("never sends a token when none is configured (fixtures mode)", async () => {
    const { fetch, calls } = recordingFetch(() => pdfResponse());
    await downloadPdf(`${BASE}/files/1`, { baseUrl: BASE, fetch });
    expect(calls[0]?.authorization).toBeNull();
  });

  it("rejects non-https, 404, non-PDF types, oversize and fake PDFs without echoing the URL", async () => {
    const secretUrl = `${BASE}/files/1/download?verifier=SIGNED-SECRET`;
    const cases: Array<[string, () => Response, RegExp]> = [
      ["404", () => new Response("nope", { status: 404 }), /status 404/],
      [
        "html",
        () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }),
        /not a PDF \(content type text\/html\)/,
      ],
      [
        "declared too big",
        () =>
          new Response(PDF, {
            status: 200,
            headers: { "content-type": "application/pdf", "content-length": String(FILE_DOWNLOAD_MAX_BYTES + 1) },
          }),
        /larger than 50 MB/,
      ],
      [
        "pdf type, not pdf bytes",
        () => new Response("hello", { status: 200, headers: { "content-type": "application/pdf" } }),
        /not a PDF/,
      ],
    ];
    for (const [, respond, pattern] of cases) {
      const { fetch } = recordingFetch(respond);
      const error = await downloadPdf(secretUrl, { baseUrl: BASE, token: TOKEN, fetch }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(pattern);
      expect((error as Error).message).not.toContain("SIGNED-SECRET");
      expect((error as Error).message).not.toContain(TOKEN);
    }
    await expect(downloadPdf("http://school.instructure.com/x.pdf", { baseUrl: BASE, token: TOKEN })).rejects.toThrow(
      /https/,
    );
  });

  it("stops reading a stream that grows past the cap without a content-length", async () => {
    const chunk = new Uint8Array(8 * 1024 * 1024);
    chunk.set(PDF);
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
        if (pulled > 20) controller.close();
      },
    });
    const { fetch } = recordingFetch(
      () => new Response(stream, { status: 200, headers: { "content-type": "application/pdf" } }),
    );
    await expect(downloadPdf(`${BASE}/big.pdf`, { baseUrl: BASE, fetch })).rejects.toThrow(/larger than 50 MB/);
    expect(pulled).toBeLessThanOrEqual(8);
  });
});
