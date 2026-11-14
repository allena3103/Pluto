import { describe, expect, it } from "vitest";
import { TOOL_NAMES } from "@pluto/core/contract";
import {
  MCP_TOOLS,
  agentHandoff,
  claudeCodeCommand,
  cursorInstallLink,
  mcpServerUrl,
  mcpServersJson,
  vscodeInstallLink,
  vscodeJson,
} from "../lib/mcp-connect";

const URL_ = "https://pluto.example/api/mcp";

describe("mcp-connect", () => {
  it("builds the server URL and drops a trailing slash", () => {
    expect(mcpServerUrl("https://pluto.example")).toBe(URL_);
    expect(mcpServerUrl("https://pluto.example/")).toBe(URL_);
  });

  it("lists every contract tool", () => {
    expect(MCP_TOOLS.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
  });

  it("builds the Claude Code command", () => {
    expect(claudeCodeCommand(URL_)).toBe(`claude mcp add --transport http pluto ${URL_}`);
  });

  it("builds valid config JSON", () => {
    expect(JSON.parse(mcpServersJson(URL_))).toEqual({ mcpServers: { pluto: { url: URL_ } } });
    expect(JSON.parse(vscodeJson(URL_))).toEqual({ servers: { pluto: { type: "http", url: URL_ } } });
  });

  it("builds install links that decode back to the URL", () => {
    const cursor = new URL(cursorInstallLink(URL_));
    expect(cursor.searchParams.get("name")).toBe("pluto");
    const config = Buffer.from(cursor.searchParams.get("config") ?? "", "base64").toString("utf8");
    expect(JSON.parse(config)).toEqual({ url: URL_ });

    const vscode = vscodeInstallLink(URL_);
    expect(vscode.startsWith("vscode:mcp/install?")).toBe(true);
    expect(JSON.parse(decodeURIComponent(vscode.slice("vscode:mcp/install?".length)))).toEqual({
      name: "pluto",
      type: "http",
      url: URL_,
    });
  });

  it("puts the URL and every tool in the agent handoff, and no secret", () => {
    const text = agentHandoff(URL_);
    expect(text).toContain(URL_);
    for (const name of TOOL_NAMES) expect(text).toContain(name);
    expect(text).not.toMatch(/demo\//);
  });
});
