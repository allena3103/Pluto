import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { toJSONSchema, type ZodType } from "zod";
import { TOOLS, TOOL_NAMES, type ToolName } from "@pluto/core/contract";
import type { ToolContext } from "@pluto/core/context";
import { TOOL_HANDLERS, ToolError } from "@pluto/core/tools/index";
import { SERVER_INSTRUCTIONS, TOOL_DESCRIPTIONS } from "./descriptions";

const GENERIC_TOOL_ERROR = "The tool failed.";

/**
 * JSON Schema object published on tools/list. Extra draft-07 keywords are kept;
 * `$schema` is dropped so clients see the tool fields directly.
 */
type ToolJsonSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

function toolJsonSchema(schema: ZodType, io: "input" | "output"): ToolJsonSchema {
  const json = toJSONSchema(schema, { target: "draft-07", io }) as Record<string, unknown>;
  delete json.$schema;
  if (json.type !== "object") {
    throw new Error("MCP tool schema must be a JSON object schema");
  }
  return json as ToolJsonSchema;
}

function toolErrorResult(text: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text }],
  };
}

/**
 * Server-side summary of a `db_error` cause (usually a PostgREST error). Only the
 * code and message are logged; the caller only ever sees the generic tool message.
 * In URL mode only the code is logged.
 */
function dbErrorCause(error: ToolError, redactErrors: boolean): Record<string, unknown> {
  const cause = (error as Error & { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") return { cause: typeof cause };
  const { code, message } = cause as { code?: unknown; message?: unknown };
  if (redactErrors) return { code };
  return { code, message };
}

function errorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "Error";
}

async function callTool(
  name: ToolName,
  ctx: ToolContext,
  args: unknown,
  redactErrors: boolean,
): Promise<CallToolResult> {
  try {
    const result = await TOOL_HANDLERS[name](ctx, args);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    };
  } catch (error) {
    if (error instanceof ToolError) {
      if (error.code === "db_error") {
        console.error(`mcp tool ${name} db_error`, dbErrorCause(error, redactErrors));
      }
      return toolErrorResult(`${error.code}: ${error.message}`);
    }
    if (redactErrors) {
      console.error(`mcp tool ${name} failed`, errorName(error));
    } else {
      console.error(`mcp tool ${name} failed`, error);
    }
    return toolErrorResult(GENERIC_TOOL_ERROR);
  }
}

export type PlutoMcpServerOptions = {
  /** URL-token mode: log the tool name and error.name only, never the error object or its message. */
  redactErrors?: boolean;
};

/**
 * One MCP server for a single request.
 * Tools are registered on the low-level `Server` with `z.toJSONSchema` so the
 * refined `GetNotePagesInput` still publishes `fileId`, `firstPage`, and `lastPage`.
 * Every call runs `TOOL_HANDLERS`, which validates input and output.
 */
export function createPlutoMcpServer(ctx: ToolContext, options?: PlutoMcpServerOptions): Server {
  const redactErrors = options?.redactErrors === true;
  const server = new Server(
    { name: "pluto", version: "0.0.0" },
    {
      capabilities: { tools: {} },
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_NAMES.map((name) => ({
      name,
      description: TOOL_DESCRIPTIONS[name],
      inputSchema: toolJsonSchema(TOOLS[name].input, "input"),
      outputSchema: toolJsonSchema(TOOLS[name].output, "output"),
      annotations: { readOnlyHint: true as const },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    if (!isToolName(name)) {
      if (redactErrors) {
        console.error("mcp tool is not in the contract");
      } else {
        console.error(`mcp tool ${name} is not in the contract`);
      }
      return toolErrorResult(GENERIC_TOOL_ERROR);
    }
    return callTool(name, ctx, request.params.arguments ?? {}, redactErrors);
  });

  return server;
}
