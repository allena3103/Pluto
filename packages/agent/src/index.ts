import type { ToolContext } from "@pluto/core/context";
import { runGemini } from "./gemini";
import { stripLinks } from "./links";
import { runMock } from "./mock";
import { defaultToolRunner } from "./runner";
import {
  EMPTY_REPLY_TEXT,
  type AgentHistoryItem,
  type AgentModelClient,
  type AgentResult,
  type AgentToolRunner,
  type CreateMagicLink,
  type RunAgentInput,
} from "./types";

export { clarificationText } from "./clarify";
export { stripLinks } from "./links";

export {
  DEFAULT_GEMINI_FAST_MODEL,
  DEFAULT_GEMINI_MODEL,
  MAX_TOOL_ROUNDS,
  type AgentCitation,
  type AgentHistoryItem,
  type AgentModelClient,
  type AgentResult,
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
  /** Server-side only. A route must not copy it from the request body. */
  model?: string;
  signal?: AbortSignal;
  client?: AgentModelClient;
}): Promise<AgentResult> {
  return runAgentSafe(input);
}

async function runAgentSafe(input: RunAgentInput): Promise<AgentResult> {
  try {
    const runTool = resolveRunner(input);
    if (!runTool) return { text: EMPTY_REPLY_TEXT, citations: [] };
    const result =
      resolveLlm(input.llm) === "gemini" ? await runGemini(input, runTool) : await runMock(input, runTool);
    if (input.channel !== "web") return result;
    // Links are for SMS. On the web, sources are chips and notes-based replies land on the Notes page.
    return { ...result, text: stripLinks(result.text) || EMPTY_REPLY_TEXT };
  } catch {
    return { text: EMPTY_REPLY_TEXT, citations: [] };
  }
}
