import { TOOL_NAMES, WRITE_TOOL_NAMES, type ToolName, type WriteToolName } from "@pluto/core/contract";
import { PROMPTS } from "@pluto/mcp/prompts";

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

/** Same for the write tool(s). Typed by WriteToolName so a new one cannot be left out. */
export const WRITE_TOOL_SUMMARIES: Record<WriteToolName, string> = {
  save_study_guide: "Saves a finished study guide to your Notes and texts you a link. It only adds one note.",
};

export type McpTool = { name: ToolName | WriteToolName; summary: string; write: boolean };

export const MCP_READ_TOOLS: readonly McpTool[] = TOOL_NAMES.map((name) => ({
  name,
  summary: TOOL_SUMMARIES[name],
  write: false,
}));

export const MCP_WRITE_TOOLS: readonly McpTool[] = WRITE_TOOL_NAMES.map((name) => ({
  name,
  summary: WRITE_TOOL_SUMMARIES[name],
  write: true,
}));

/** Every tool the server offers: the read tools, then the write tool. */
export const MCP_TOOLS: readonly McpTool[] = [...MCP_READ_TOOLS, ...MCP_WRITE_TOOLS];

/** The accurate access line shown on the page and in the agent handoff. */
export const ACCESS_SUMMARY =
  "It reads your own courses, notes, deadlines and grades. The one write tool, save_study_guide, only saves a study guide to your Notes and texts you a link to it. It cannot edit or delete anything.";

/** The three one-click prompts, straight from the server so the page cannot drift from it. */
export const MCP_PROMPTS = PROMPTS;

/** Where each client shows the server's prompts. */
export const PROMPT_LOCATIONS: readonly { client: string; where: string }[] = [
  { client: "Claude", where: "Press the + menu in the chat box, then Pluto." },
  { client: "Cursor", where: "Type / in the chat box and pick a Pluto prompt." },
  { client: "ChatGPT", where: "ChatGPT has no MCP prompts. Copy the matching example prompt below instead." },
];

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
    `Pluto gives you my courses, lecture notes, deadlines and grades. ${ACCESS_SUMMARY} Tools:`,
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
  "Build me a study guide from my History 105 notes from the past 2 weeks, use Pluto, and save it to Pluto.",
  "Quiz me on my History 105 notes with 8 questions. Put the answers at the end, each linking to the exact page. Use Pluto.",
  "What is due this week, and which of my weeks ahead are the busiest? Use Pluto.",
  "Where do my notes cover the causes of World War I? Use Pluto and link the pages.",
];
