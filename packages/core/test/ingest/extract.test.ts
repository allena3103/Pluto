// extractPdfPages on the committed synthetic PDFs. No database: runs everywhere.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractPdfPages, notesStoragePath } from "../../src/ingest";

const pdfDir = fileURLToPath(new URL("../../../../seed/pdfs/", import.meta.url));
interface Entry {
  file: string;
  pages: { page: number; fact: string; query: string }[];
}
const manifest = JSON.parse(readFileSync(`${pdfDir}manifest.json`, "utf8")) as Entry[];

function load(file: string): Uint8Array {
  return new Uint8Array(readFileSync(`${pdfDir}${file}`));
}

describe("extractPdfPages", () => {
  it("has 6-10 seed PDFs", () => {
    expect(manifest.length).toBeGreaterThanOrEqual(6);
    expect(manifest.length).toBeLessThanOrEqual(10);
  });

  it.each(manifest.map((m) => [m.file, m] as const))("%s: one text per page, each with its fact", async (_file, entry) => {
    const pages = await extractPdfPages(load(entry.file));
    expect(pages).toHaveLength(entry.pages.length);
    for (const expected of entry.pages) {
      // Page numbers are 1-based: page N is index N - 1.
      expect(pages[expected.page - 1]).toContain(expected.fact);
    }
    expect(pages.every((text) => !/\s{2,}|\n/.test(text))).toBe(true);
  });

  it("every fact appears on exactly one page across all seed PDFs", async () => {
    const all: string[] = [];
    for (const entry of manifest) all.push(...(await extractPdfPages(load(entry.file))));
    for (const entry of manifest) {
      for (const page of entry.pages) {
        expect(all.filter((text) => text.includes(page.fact)), page.fact).toHaveLength(1);
      }
    }
  });

  it("rejects empty input and non-PDF bytes", async () => {
    await expect(extractPdfPages(new Uint8Array())).rejects.toThrow();
    await expect(extractPdfPages(new TextEncoder().encode("not a pdf"))).rejects.toThrow();
  });

  it("builds the storage path from the owner and the file id", () => {
    expect(notesStoragePath("student-1", "file-2")).toBe("student-1/file-2.pdf");
  });
});
