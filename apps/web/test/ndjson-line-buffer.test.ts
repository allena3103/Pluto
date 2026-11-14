import { describe, expect, it } from "vitest";
import { parseNdjsonLine, splitNdjsonChunk } from "../components/chat/ndjson-line-buffer";

describe("splitNdjsonChunk", () => {
  it("splits complete lines and keeps a partial tail", () => {
    let remainder = "";
    const first = splitNdjsonChunk(remainder, '{"type":"text","delta":"hel');
    remainder = first.remainder;
    expect(first.lines).toEqual([]);

    const second = splitNdjsonChunk(remainder, 'lo"}\n{"type":"done","sessionId":"s1"}\n');
    expect(second.lines).toHaveLength(2);
    expect(second.remainder).toBe("");
  });

  it("handles chunk boundaries across multiple lines", () => {
    const { lines, remainder } = splitNdjsonChunk(
      '{"type":"text","delta":"a"}\n{"type":"te',
      'xt","delta":"b"}\n',
    );
    expect(lines).toEqual(['{"type":"text","delta":"a"}', '{"type":"text","delta":"b"}']);
    expect(remainder).toBe("");
  });
});

describe("parseNdjsonLine", () => {
  it("parses valid events", () => {
    const parsed = parseNdjsonLine(JSON.stringify({ type: "text", delta: "hi" }));
    expect(parsed).toEqual({ kind: "event", event: { type: "text", delta: "hi" } });
  });

  it("ignores blank lines", () => {
    expect(parseNdjsonLine("   ")).toEqual({ kind: "blank" });
  });

  it("returns invalid for malformed JSON or unknown shape", () => {
    expect(parseNdjsonLine("{not json")).toEqual({ kind: "invalid" });
    expect(parseNdjsonLine(JSON.stringify({ type: "nope" }))).toEqual({ kind: "invalid" });
  });
});