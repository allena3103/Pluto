import type { ToolContext } from "@pluto/core/context";

export const DEFAULT_GEMINI_MODEL = "gemini-4-hydrogen";
export const MAX_TOOL_ROUNDS = 4;
export const MODEL_TIMEOUT_MS = 20_000;
export const TOOL_TIMEOUT_MS = 10_000;
export const TOOL_RESULT_MAX_CHARS = 20_000;

export const TOOL_FAILURE_TEXT = "Something went wrong while looking that up. Try again in a moment.";
export const EMPTY_REPLY_TEXT = "I couldn't put an answer together just now. Try again in a moment.";

export type AgentCitation = { fileId: string; page: number; deepLink: string };
export type AgentHistoryItem = { role: "user" | "assistant"; text: string };
export type AgentToolRunner = (name: string, args: unknown) => Promise<unknown>;
export type CreateMagicLink = (input: { fileId: string; page: number }) => Promise<{ url: string }>;

export type AgentResult = { text: string; citations: AgentCitation[]; magicLinkUrl?: string };

/** One Interactions API turn. Tests pass a fake; production wraps `GoogleGenAI`. */
export type AgentModelTurn = {
  steps?: unknown[];
  output_text?: string;
};

export type AgentModelRequest = {
  model: string;
  store: false;
  stream: false;
  input: unknown[];
  tools: AgentToolDeclaration[];
  system_instruction: string;
};

export type AgentModelClient = {
  interactions: {
    create: (
      params: AgentModelRequest,
      options?: { timeout_ms?: number; signal?: AbortSignal },
    ) => Promise<AgentModelTurn>;
  };
};

export type AgentToolDeclaration = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type RunAgentInput = {
  message: string;
  channel: "web" | "sms";
  history?: AgentHistoryItem[];
  ctx?: ToolContext;
  runTool?: AgentToolRunner;
  createMagicLink?: CreateMagicLink;
  llm?: "mock" | "gemini";
  model?: string;
  signal?: AbortSignal;
  /** Injected Interactions client. When set, the Gemini path does not construct the SDK client. */
  client?: AgentModelClient;
};
