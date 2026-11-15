// extractDocumentPages on generated Word files. No database: runs everywhere.
import mammoth from "mammoth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DOCX_MAX_UNPACKED_BYTES, DOCX_PAGE_CHARS, extractDocumentPages } from "../../src/assignment-ingest";
import { makeDocx } from "./assignment-ingest-docx";

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

  it("rejects empty input and bytes that are not a Word file", async () => {
    await expect(extractDocumentPages(new Uint8Array(), "docx")).rejects.toThrow(/empty/);
    await expect(extractDocumentPages(new TextEncoder().encode("<html>login</html>"), "docx")).rejects.toThrow();
    await expect(extractDocumentPages(new TextEncoder().encode("not a pdf"), "pdf")).rejects.toThrow();
  });
});

describe("extractDocumentPages refuses Word zip bombs before mammoth sees them", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads a normal deflated Word file", async () => {
    const pages = await extractDocumentPages(makeDocx(["Deflated handout", "Second paragraph."], { deflate: true, filler: 2000 }), "docx");
    expect(pages).toEqual(["Deflated handout\n\nSecond paragraph."]);
  });

  it.each([
    // word/document.xml really unpacks past the cap while its header claims 1,000 bytes.
    ["a lying header", { deflate: true, filler: DOCX_MAX_UNPACKED_BYTES + 1024, declaredDocumentSize: 1000 }, /unpacks to more than 25 MB/],
    // Honest header past the cap: refused from the central directory without unpacking.
    ["an honest header past the cap", { deflate: true, filler: DOCX_MAX_UNPACKED_BYTES + 1024 }, /unpacks to more than 25 MB/],
    // 4 MB of spaces deflate about 1000:1.
    ["an extreme compression ratio", { deflate: true, filler: 4 * 1024 * 1024 }, /compressed too much/],
  ] as const)("%s ends in a clear error, with no mammoth call", async (_label, options, error) => {
    const extract = vi.spyOn(mammoth, "extractRawText");
    await expect(extractDocumentPages(makeDocx(["Boom", "Bang"], options), "docx")).rejects.toThrow(error);
    expect(extract).not.toHaveBeenCalled();
  });

  it("refuses zips it does not read the way JSZip would", async () => {
    const extract = vi.spyOn(mammoth, "extractRawText");
    const docx = makeDocx(["Shifted"]);
    const prefixed = new Uint8Array(docx.length + 4);
    prefixed.set([0x50, 0x4b, 0x03, 0x04]);
    prefixed.set(docx, 4);
    await expect(extractDocumentPages(prefixed, "docx")).rejects.toThrow(/damaged/);

    const unsupported = makeDocx(["Bzip2"]);
    const view = Buffer.from(unsupported.buffer);
    const directory = view.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    view.writeUInt16LE(12, directory + 10); // bzip2
    await expect(extractDocumentPages(unsupported, "docx")).rejects.toThrow(/not supported/);
    expect(extract).not.toHaveBeenCalled();
  });
});
