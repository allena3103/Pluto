import type { ToolContext } from "@pluto/core/context";
import { TOOL_NAMES, type ToolName } from "@pluto/core/contract";
import { TOOL_HANDLERS } from "@pluto/core/tools/index";
import type { AgentToolRunner } from "./types";

export function isKnownTool(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

export function defaultToolRunner(ctx: ToolContext): AgentToolRunner {
  return (name, args) => {
    if (!isKnownTool(name)) return Promise.resolve({ error: "Unknown tool." });
    return TOOL_HANDLERS[name](ctx, args ?? {});
  };
}

export function normalizeArgs(raw: unknown): { ok: true; args: Record<string, unknown> } | { ok: false } {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return { ok: false };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false };
  return { ok: true, args: value as Record<string, unknown> };
}
