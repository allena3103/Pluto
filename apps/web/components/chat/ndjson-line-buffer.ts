import { ChatStreamEvent } from "@pluto/core/contract";

export type ParsedNdjsonLine =
  | { kind: "event"; event: ChatStreamEvent }
  | { kind: "blank" }
  | { kind: "invalid" };

/** Split an incoming chunk into complete lines; `remainder` holds a partial final line. */
export function splitNdjsonChunk(
  remainder: string,
  chunk: string,
): { remainder: string; lines: string[] } {
  const combined = remainder + chunk;
  const parts = combined.split("\n");
  const nextRemainder = parts.pop() ?? "";
  return { remainder: nextRemainder, lines: parts };
}

export function parseNdjsonLine(line: string): ParsedNdjsonLine {
  if (line.trim() === "") {
    return { kind: "blank" };
  }
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return { kind: "invalid" };
  }
  const parsed = ChatStreamEvent.safeParse(json);
  if (!parsed.success) {
    return { kind: "invalid" };
  }
  return { kind: "event", event: parsed.data };
}