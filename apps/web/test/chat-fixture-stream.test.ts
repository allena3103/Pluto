import { describe, expect, it } from "vitest";
import { createChatFixtureStream } from "../components/chat/fixture-stream";
import { parseNdjsonLine, splitNdjsonChunk } from "../components/chat/ndjson-line-buffer";

async function collectLines(message: string): Promise<string[]> {
  const stream = createChatFixtureStream(
    message,
    undefined,
    new AbortController().signal,
    "https://pluto.example.com",
  );
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let remainder = "";
  const lines: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const split = splitNdjsonChunk(remainder, decoder.decode(value, { stream: true }));
    remainder = split.remainder;
    lines.push(...split.lines);
  }
  if (remainder) lines.push(remainder);
  return lines;
}

describe("chat fixture stream", () => {
  it("emits only lines that satisfy the contract", async () => {
    const lines = await collectLines("hello");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(parseNdjsonLine(line).kind).toBe("event");
    }
    const citations = lines
      .map((l) => parseNdjsonLine(l))
      .filter((p) => p.kind === "event" && p.event.type === "citation");
    expect(citations).toHaveLength(2);
  });

  it("emits a valid error line", async () => {
    const lines = await collectLines("fixture error");
    for (const line of lines) {
      expect(parseNdjsonLine(line).kind).toBe("event");
    }
  });
});
