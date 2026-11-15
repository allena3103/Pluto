// Reads the raw text out of one PDF or Word file for assignment-ingest.ts. It runs in a worker
// thread with its own heap limit and a wall-clock timer, so a file that is too big or too
// complex to parse ends this worker, not the server. Plain JS on purpose: it runs as-is under
// vitest, tsx and the Next server.
//
// In:  { fileType: "pdf" | "docx", buffer: ArrayBuffer (transferred), maxPages: number }
// Out: { ok: true, text: string[] (pdf pages) | string (docx), buffer } or { ok: false, message, buffer };
//      the buffer is transferred back so the caller can store the same bytes.
import { parentPort } from "node:worker_threads";

parentPort?.once("message", async ({ fileType, buffer, maxPages }) => {
  try {
    let text;
    if (fileType === "pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      // unpdf detaches the buffer it is given; the original goes back to the caller.
      const pdf = await getDocumentProxy(new Uint8Array(buffer.slice(0)));
      if (pdf.numPages > maxPages) throw new Error(`PDF has more than ${maxPages} pages`);
      text = (await extractText(pdf, { mergePages: false })).text;
    } else {
      const { default: mammoth } = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer: Buffer.from(buffer) })).value;
    }
    parentPort.postMessage({ ok: true, text, buffer }, [buffer]);
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "Could not read the file";
    parentPort.postMessage({ ok: false, message, buffer }, [buffer]);
  }
});
