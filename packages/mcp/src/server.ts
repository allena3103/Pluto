import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TOOLS, TOOL_NAMES, type ToolName } from "@pluto/core/contract";
import type { ToolContext } from "@pluto/core/context";
import { TOOL_HANDLERS, ToolError } from "@pluto/core/tools/index";
import { SERVER_INSTRUCTIONS, TOOL_DESCRIPTIONS } from "./descriptions";

const GENERIC_TOOL_ERROR = "The tool failed.";

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
 * One MCP server for a single request. Tools come from the contract.
 * Each call goes through `TOOL_HANDLERS`, which validates input and output.
 */
export function createPlutoMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "pluto", version: "0.0.0" }, { instructions: SERVER_INSTRUCTIONS });

  for (const name of TOOL_NAMES) {
    const spec = TOOLS[name];
    server.registerTool(
      name,
      {
        description: TOOL_DESCRIPTIONS[name],
        inputSchema: spec.input,
        outputSchema: spec.output,
        annotations: { readOnlyHint: true },
      },
      async (args: Record<string, unknown>) => callTool(name, ctx, args),
    );
  }

  return server;
}
