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

async function callTool(name: ToolName, ctx: ToolContext, args: unknown): Promise<CallToolResult> {
  try {
    const result = await TOOL_HANDLERS[name](ctx, args);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    };
  } catch (error) {
    if (error instanceof ToolError) {
      return toolErrorResult(`${error.code}: ${error.message}`);
    }
    console.error(`mcp tool ${name} failed`, error);
    return toolErrorResult(GENERIC_TOOL_ERROR);
  }
}

/**
 * One MCP server for a single request.
 * Tools are registered on the low-level `Server` with `z.toJSONSchema` so the
 * refined `GetNotePagesInput` still publishes `fileId`, `firstPage`, and `lastPage`.
 * Every call runs `TOOL_HANDLERS`, which validates input and output.
 */
export function createPlutoMcpServer(ctx: ToolContext): Server {
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
      console.error(`mcp tool ${name} is not in the contract`);
      return toolErrorResult(GENERIC_TOOL_ERROR);
    }
    return callTool(name, ctx, request.params.arguments ?? {});
  });

  return server;
}
