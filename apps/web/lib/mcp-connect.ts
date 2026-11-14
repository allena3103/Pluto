import { TOOL_NAMES, type ToolName } from "@pluto/core/contract";

/** Name the server gets in every client config. */
export const MCP_SERVER_NAME = "pluto";

/** Plain-language line per tool for the MCP page. Typed by ToolName so a new tool cannot be left out. */
export const TOOL_SUMMARIES: Record<ToolName, string> = {
  list_courses: "Your courses, with name and term.",
  get_recent_notes: "Full text of the lecture notes added to a course in the last days or weeks.",
  get_note_pages: "The pages of one file, each with a link back to the page.",
  search_notes: "Search your notes for a topic.",
  get_deadlines: "What is due soon, and whether a due date moved.",
  get_grades: "Your grade per group and your running grade.",
  get_crunch_weeks: "Your busiest weeks ahead, ranked.",
};

export type McpTool = { name: ToolName; summary: string };

export const MCP_TOOLS: readonly McpTool[] = TOOL_NAMES.map((name) => ({ name, summary: TOOL_SUMMARIES[name] }));

/** The server URL shown on the page. `appUrl` is the deployed origin; a trailing slash is dropped. */
export function mcpServerUrl(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, "")}/api/mcp`;
}

export function claudeCodeCommand(url: string): string {
  return `claude mcp add --transport http ${MCP_SERVER_NAME} ${url}`;
}

export function codexCommand(url: string): string {
  return `codex mcp add ${MCP_SERVER_NAME} --url ${url}`;
}

/** `mcpServers` block used by Cursor, Claude Desktop-style clients and most others. */
export function mcpServersJson(url: string): string {
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { url } } }, null, 2);
}

/** VS Code `.vscode/mcp.json` block. */
export function vscodeJson(url: string): string {
  return JSON.stringify({ servers: { [MCP_SERVER_NAME]: { type: "http", url } } }, null, 2);
}

function base64(text: string): string {
  return typeof btoa === "function" ? btoa(text) : Buffer.from(text, "utf8").toString("base64");
}

/** One-click install link for Cursor. The config is base64 JSON, as Cursor's deeplink expects. */
export function cursorInstallLink(url: string): string {
  const config = encodeURIComponent(base64(JSON.stringify({ url })));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${MCP_SERVER_NAME}&config=${config}`;
}

/** One-click install link for VS Code. */
export function vscodeInstallLink(url: string): string {
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: MCP_SERVER_NAME, type: "http", url }))}`;
}

/** A block the student can paste into any agent so it sets the server up itself. */
export function agentHandoff(url: string): string {
  return [
    "Add the Pluto MCP server to this client.",
    "",
    `Name: ${MCP_SERVER_NAME}`,
    `URL: ${url}`,
    "Transport: streamable HTTP",
    "Auth: OAuth. A browser window opens once so I can sign in to Pluto. No API key is needed.",
    "",
    "Pluto is a read-only view of my courses, lecture notes, deadlines and grades. Tools:",
    ...MCP_TOOLS.map((tool) => `- ${tool.name}: ${tool.summary}`),
    "",
    "If you can run shell commands and this is Claude Code, run:",
    claudeCodeCommand(url),
    "",
    "Otherwise add this to the MCP config file:",
    mcpServersJson(url),
    "",
    "When it is connected, call list_courses to check it works. Cite note pages with the deep links the tools return.",
  ].join("\n");
}

export const EXAMPLE_PROMPTS: readonly string[] = [
  "Build me a study guide from my History 105 notes from the past 2 weeks, use Pluto.",
  "What is due this week, and which of my weeks ahead are the busiest? Use Pluto.",
  "Where do my notes cover the causes of World War I? Use Pluto and link the pages.",
];
