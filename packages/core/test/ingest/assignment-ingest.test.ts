// extractDocumentPages / readDocument / checkDocxZip on generated files. No database: runs everywhere.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkDocxZip,
  DOCX_MAX_UNPACKED_BYTES,
  DOCX_PAGE_CHARS,
  extractDocumentPages,
  READ_LIMITS,
  READ_TIMEOUT_MESSAGE,
  READ_TOO_BIG_MESSAGE,
  readDocument,
} from "../../src/assignment-ingest";
import { makeDocx } from "./assignment-ingest-docx";

const PDF = new Uint8Array(
  readFileSync(fileURLToPath(new URL("../../../canvas/fixtures/demo/files/stat-proposal-guidelines.pdf", import.meta.url))),
);
/** ~3 MB of tiny paragraphs, stored (ratio 1): passes every byte check, but its DOM is big. */
const DOM_BOMB = makeDocx(Array.from({ length: 60_000 }, () => "a"));
/** Small heap so the bomb runs out of memory in well under a second. */
const TINY_HEAP = { ...READ_LIMITS, maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4 };

describe("extractDocumentPages (docx)", () => {
  it("keeps paragraphs apart with a blank line, collapses spaces and drops empty paragraphs", async () => {
    const pages = await extractDocumentPages(
      makeDocx(["BIA Project Description", "", "Identify   three\tcritical processes & rank them.", "   ", "Due Friday."]),
      "docx",
    );
    expect(pages).toEqual(["BIA Project Description\n\nIdentify three critical processes & rank them.\n\nDue Friday."]);
  });

  it("packs whole paragraphs into pages of at most DOCX_PAGE_CHARS, in order", async () => {
    const paragraphs = Array.from({ length: 12 }, (_, index) => `Paragraph ${index + 1}. ${"word ".repeat(140).trim()}`);
    const pages = await extractDocumentPages(makeDocx(paragraphs), "docx");
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.length <= DOCX_PAGE_CHARS)).toBe(true);
    // No paragraph is cut: rejoining the pages gives the paragraphs back in order.
    expect(pages.flatMap((page) => page.split("\n\n"))).toEqual(paragraphs);
  });

  it("cuts a paragraph longer than a page at spaces without losing words", async () => {
    const words = Array.from({ length: 1500 }, (_, index) => `w${index}`);
    const pages = await extractDocumentPages(makeDocx([words.join(" ")]), "docx");
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.length <= DOCX_PAGE_CHARS)).toBe(true);
    expect(pages.join(" ").split(" ")).toEqual(words);
  });

  it("has no pages when the file has no text", async () => {
    expect(await extractDocumentPages(makeDocx([]), "docx")).toEqual([]);
  });

  it("rejects empty input and bytes that are not a Word file or a PDF", async () => {
    await expect(extractDocumentPages(new Uint8Array(), "docx")).rejects.toThrow(/empty/);
    await expect(extractDocumentPages(new TextEncoder().encode("<html>login</html>"), "docx")).rejects.toThrow();
    await expect(extractDocumentPages(new TextEncoder().encode("not a pdf"), "pdf")).rejects.toThrow();
  });
});

describe("reading in a worker", () => {
  it("reads a PDF, moves the bytes to the worker and back, and leaves the caller's copy alone", async () => {
    const input = PDF.slice();
    const read = await readDocument(input, "pdf");
    expect(read.pages).toHaveLength(2);
    expect(read.pages[1]).toContain("scatterplot");
    expect(read.bytes).toEqual(PDF);
    expect(input.byteLength).toBe(0); // transferred, not copied

    const kept = PDF.slice();
    expect(await extractDocumentPages(kept, "pdf")).toEqual(read.pages);
    expect(kept.byteLength).toBe(PDF.byteLength);
  });

  it("ends a parse that runs out of memory, and this thread carries on", async () => {
    const started = performance.now();
    await expect(readDocument(DOM_BOMB.slice(), "docx", TINY_HEAP)).rejects.toThrow(READ_TOO_BIG_MESSAGE);
    expect(performance.now() - started).toBeLessThan(5_000);
    // Same thread, next file: still fine.
    expect(await extractDocumentPages(makeDocx(["After the bomb"]), "docx")).toEqual(["After the bomb"]);
  });

  it("ends a parse that takes too long", async () => {
    await expect(readDocument(DOM_BOMB.slice(), "docx", { ...READ_LIMITS, timeoutMs: 1 })).rejects.toThrow(READ_TIMEOUT_MESSAGE);
    expect(await extractDocumentPages(makeDocx(["After the timeout"]), "docx")).toEqual(["After the timeout"]);
  });
});

/** Changes one 16-bit field of the end-of-central-directory record. */
function withEndField(docx: Uint8Array, offset: number, value: number): Uint8Array {
  const copy = Buffer.from(docx);
  copy.writeUInt16LE(value, copy.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) + offset);
  return new Uint8Array(copy);
}

describe("checkDocxZip refuses Word zip bombs and zips JSZip would read differently", () => {
  it("passes a normal deflated Word file", async () => {
    const docx = makeDocx(["Deflated handout", "Second paragraph."], { deflate: true, filler: 2000 });
    expect(() => checkDocxZip(docx)).not.toThrow();
    expect(await extractDocumentPages(docx, "docx")).toEqual(["Deflated handout\n\nSecond paragraph."]);
  });

  it.each([
    // word/document.xml really unpacks past the cap while its header claims 1,000 bytes.
    ["a lying header", { deflate: true, filler: DOCX_MAX_UNPACKED_BYTES + 1024, declaredDocumentSize: 1000 }, /unpacks to more than 25 MB/],
    // Honest header past the cap: refused from the central directory without unpacking.
    ["an honest header past the cap", { deflate: true, filler: DOCX_MAX_UNPACKED_BYTES + 1024 }, /unpacks to more than 25 MB/],
    // 4 MB of spaces deflate about 1000:1.
    ["an extreme compression ratio", { deflate: true, filler: 4 * 1024 * 1024 }, /compressed too much/],
  ] as const)("%s is refused before any parser runs", async (_label, options, error) => {
    const docx = makeDocx(["Boom", "Bang"], options);
    expect(() => checkDocxZip(docx)).toThrow(error);
    await expect(extractDocumentPages(docx, "docx")).rejects.toThrow(error);
  });

  it.each([
    // JSZip reads every central header it finds whatever the end record says.
    ["an entry count of 0", (docx: Uint8Array) => withEndField(withEndField(docx, 8, 0), 10, 0), /damaged/],
    ["an entry count lower than the headers present", (docx: Uint8Array) => withEndField(withEndField(docx, 8, 2), 10, 2), /damaged/],
    // Any 0xFFFF field sends JSZip to a ZIP64 directory the check never saw.
    ["a disk number of 0xFFFF", (docx: Uint8Array) => withEndField(docx, 4, 0xffff), /not supported/],
    ["a directory disk of 0xFFFF", (docx: Uint8Array) => withEndField(docx, 6, 0xffff), /not supported/],
    ["entries on this disk of 0xFFFF", (docx: Uint8Array) => withEndField(docx, 8, 0xffff), /not supported/],
    ["entries on this disk unlike the total", (docx: Uint8Array) => withEndField(docx, 8, 1), /not supported/],
  ] as const)("%s is refused", (_label, edit, error) => {
    expect(() => checkDocxZip(edit(makeDocx(["Bomb behind a decoy"])))).toThrow(error);
  });

  it("refuses prepended data and compression other than stored or deflate", () => {
    const docx = makeDocx(["Shifted"]);
    const prefixed = new Uint8Array(docx.length + 4);
    prefixed.set([0x50, 0x4b, 0x03, 0x04]);
    prefixed.set(docx, 4);
    expect(() => checkDocxZip(prefixed)).toThrow(/damaged/);

    const unsupported = Buffer.from(makeDocx(["Bzip2"]));
    unsupported.writeUInt16LE(12, unsupported.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10); // bzip2
    expect(() => checkDocxZip(new Uint8Array(unsupported))).toThrow(/not supported/);
  });
});
