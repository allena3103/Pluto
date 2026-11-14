import { describe, expect, test } from "vitest";
import { TOOL_NAMES } from "@pluto/core/contract";
import { handleMcpRequest } from "../src/handler";
import { ACCEPT, UNIT_TOKEN, mcpResult, postMcp, rpcBody, unitConfig } from "./request";

describe("mcp handler auth", () => {
  test("401 and WWW-Authenticate when the demo token is missing, wrong, unset, too short, or not Bearer", async () => {
    const cases: Array<{ config: ReturnType<typeof unitConfig>; authorization?: string }> = [
      { config: unitConfig() },
      { config: unitConfig(), authorization: `Bearer ${"not-the-token".padEnd(32, "x")}` },
      { config: unitConfig({ demoToken: undefined }), authorization: `Bearer ${UNIT_TOKEN}` },
      { config: unitConfig({ demoToken: "too-short-token" }), authorization: "Bearer too-short-token" },
      { config: unitConfig(), authorization: "Basic cGx1dG8=" },
    ];

    for (const item of cases) {
      const response = await postMcp(item.config, rpcBody("tools/call", { name: "list_courses", arguments: {} }), item.authorization);
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
      await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    }
  });

  test("GET and DELETE are 401 without a token and 405 after auth", async () => {
    const config = unitConfig();
    for (const method of ["GET", "DELETE"] as const) {
      const unauthenticated = await handleMcpRequest(
        new Request("http://127.0.0.1:3301/api/mcp", { method, headers: { accept: ACCEPT } }),
        config,
      );
      expect(unauthenticated.status).toBe(401);

      const authenticated = await handleMcpRequest(
        new Request("http://127.0.0.1:3301/api/mcp", {
          method,
          headers: { accept: ACCEPT, authorization: `Bearer ${UNIT_TOKEN}` },
        }),
        config,
      );
      expect(authenticated.status).toBe(405);
    }
  });
});

describe("mcp tools/list", () => {
  test("initialize and tools/list expose the seven contract tools", async () => {
    const config = unitConfig();
    const token = `Bearer ${UNIT_TOKEN}`;

    const initialized = await mcpResult(
      await postMcp(
        config,
        rpcBody("initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "pluto-test", version: "0.0.0" },
        }),
        token,
      ),
    );
    expect(initialized.status).toBe(200);
    expect(initialized.body.result?.protocolVersion).toEqual(expect.any(String));
    expect(String(initialized.body.result?.instructions)).toContain("get_note_pages");

    const listed = await mcpResult(await postMcp(config, rpcBody("tools/list", {}), token));
    expect(listed.status).toBe(200);
    const tools = listed.body.result?.tools as Array<{
      name: string;
      description?: string;
      inputSchema?: { properties?: Record<string, unknown> };
      outputSchema?: Record<string, unknown>;
      annotations?: { readOnlyHint?: boolean };
    }>;
    expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toBeTruthy();
      expect(tool.outputSchema).toBeTruthy();
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
    const notePages = tools.find((tool) => tool.name === "get_note_pages");
    const schemaText = JSON.stringify(notePages?.inputSchema);
    expect(schemaText).toContain("fileId");
    expect(schemaText).toContain("firstPage");
    expect(schemaText).toContain("lastPage");
  });
});
