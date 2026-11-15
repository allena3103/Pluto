import { describe, expect, it } from "vitest";
import { TOOL_NAMES, WRITE_TOOL_NAMES } from "@pluto/core/contract";
import { PROMPT_NAMES } from "@pluto/mcp/prompts";
import {
  ACCESS_SUMMARY,
  EXAMPLE_PROMPTS,
  MCP_PROMPTS,
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
    expect(MCP_TOOLS.map((tool) => tool.name)).toEqual([...TOOL_NAMES, ...WRITE_TOOL_NAMES]);
    expect(MCP_TOOLS.filter((tool) => tool.write).map((tool) => tool.name)).toEqual(["save_study_guide"]);
  });

  it("lists every prompt and no longer claims read-only", () => {
    expect(MCP_PROMPTS.map((p) => p.name)).toEqual([...PROMPT_NAMES]);
    expect(ACCESS_SUMMARY).toContain("cannot edit or delete");
    expect(agentHandoff(URL_)).not.toMatch(/read-only/i);
  });

  it("has the save and citation example prompts", () => {
    expect(EXAMPLE_PROMPTS.some((p) => /save it to Pluto/.test(p))).toBe(true);
    expect(EXAMPLE_PROMPTS.some((p) => /Quiz me/.test(p) && /exact page/.test(p))).toBe(true);
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
