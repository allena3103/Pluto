import type { ToolContext } from "@pluto/core/context";
import type { ClarifyingQuestion } from "@pluto/core/contract";

/** Web chat. gemini-3.8-flash timed out (>30s) and gemini-3.5-flash took ~11s per call on 2026-11-14, past the 20s budget for a tool loop; raise via GEMINI_MODEL once they are faster. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
/** Tier 2: low-latency, high-volume replies (SMS). Override with GEMINI_FAST_MODEL. */
export const DEFAULT_GEMINI_FAST_MODEL = "gemini-3.5-flash-lite";
export const MAX_TOOL_ROUNDS = 4;
export const MODEL_TIMEOUT_MS = 20_000;
export const TOOL_TIMEOUT_MS = 10_000;
export const TOOL_RESULT_MAX_CHARS = 20_000;

export const TOOL_FAILURE_TEXT = "Something went wrong while looking that up. Try again in a moment.";
export const EMPTY_REPLY_TEXT = "I couldn't put an answer together just now. Try again in a moment.";

export type AgentCitation = { fileId: string; page: number; deepLink: string };
export type AgentHistoryItem = { role: "user" | "assistant"; text: string };
export type AgentToolRunner = (name: string, args: unknown) => Promise<unknown>;
/**
 * The host must mint a link only for a file that belongs to this student.
 * This package does not check ownership.
 */
export type CreateMagicLink = (input: { fileId: string; page: number }) => Promise<{ url: string }>;

/** Web only. The agent stops and asks; the host shows the questions and the student answers in a new message. */
export const ASK_TOOL_NAME = "ask_clarifying_questions";

/** `questions` is set when the agent needs more detail; `text` is then a short lead-in to them. */
export type AgentResult = {
  text: string;
  citations: AgentCitation[];
  magicLinkUrl?: string;
  questions?: ClarifyingQuestion[];
  /** The loop stopped (timeout, error, round cap) before a final answer; `text` may be a preamble. */
  partial?: boolean;
};

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
  /** Server-side only. A route must not copy it from the request body. */
  model?: string;
  signal?: AbortSignal;
  /** Injected Interactions client. When set, the Gemini path does not construct the SDK client. */
  client?: AgentModelClient;
};
