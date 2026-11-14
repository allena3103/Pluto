import type { ToolContext } from "@pluto/core/context";
import { runGemini } from "./gemini";
import { runMock } from "./mock";
import { defaultToolRunner } from "./runner";
import {
  EMPTY_REPLY_TEXT,
  type AgentCitation,
  type AgentHistoryItem,
  type AgentModelClient,
  type AgentToolRunner,
  type CreateMagicLink,
  type RunAgentInput,
} from "./types";

export {
  DEFAULT_GEMINI_MODEL,
  MAX_TOOL_ROUNDS,
  type AgentCitation,
  type AgentHistoryItem,
  type AgentModelClient,
  type AgentToolRunner,
  type CreateMagicLink,
} from "./types";

function resolveLlm(llm: RunAgentInput["llm"]): "mock" | "gemini" {
  if (llm === "mock" || llm === "gemini") return llm;
  const env = process.env.PLUTO_LLM;
  if (env === "mock" || env === "gemini") return env;
  return "mock";
}

function resolveRunner(input: RunAgentInput): AgentToolRunner | undefined {
  if (input.runTool) return input.runTool;
  if (!input.ctx) return undefined;
  return defaultToolRunner(input.ctx);
}

export function runAgent(input: {
  message: string;
  channel: "web" | "sms";
  history?: AgentHistoryItem[];
  ctx?: ToolContext;
  runTool?: AgentToolRunner;
  createMagicLink?: CreateMagicLink;
  llm?: "mock" | "gemini";
  model?: string;
  signal?: AbortSignal;
  client?: AgentModelClient;
}): Promise<{ text: string; citations: AgentCitation[]; magicLinkUrl?: string }> {
  return runAgentSafe(input);
}

async function runAgentSafe(
  input: RunAgentInput,
): Promise<{ text: string; citations: AgentCitation[]; magicLinkUrl?: string }> {
  try {
    const runTool = resolveRunner(input);
    if (!runTool) return { text: EMPTY_REPLY_TEXT, citations: [] };
    if (resolveLlm(input.llm) === "gemini") return await runGemini(input, runTool);
    return await runMock(input, runTool);
  } catch {
    return { text: EMPTY_REPLY_TEXT, citations: [] };
  }
}
