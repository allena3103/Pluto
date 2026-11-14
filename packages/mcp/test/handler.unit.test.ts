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

describe("mcp demo url token", () => {
  const listBody = rpcBody("tools/list", {});

  async function urlCall(config: ReturnType<typeof unitConfig>, urlToken: string): Promise<Response> {
    return postMcp(config, listBody, undefined, "http://127.0.0.1:3301/api/mcp", { urlToken });
  }

  test("flag unset or not exactly 1 is 404 even with the right token, and does not advertise Bearer", async () => {
    for (const demoUrlFlag of [undefined, "", "true", "0"]) {
      const response = await urlCall(unitConfig({ demoUrlFlag }), UNIT_TOKEN);
      expect(response.status).toBe(404);
      expect(response.headers.get("www-authenticate")).toBeNull();
      await expect(response.json()).resolves.toEqual({ error: "not_found" });
    }
  });

  test("flag 1 with the right token lists the seven tools", async () => {
    const response = await mcpResult(await urlCall(unitConfig({ demoUrlFlag: "1" }), UNIT_TOKEN));
    expect(response.status).toBe(200);
    const tools = response.body.result?.tools as Array<{ name: string }>;
    expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
  });

  test("flag 1 with the wrong token is 404 without WWW-Authenticate", async () => {
    const response = await urlCall(unitConfig({ demoUrlFlag: "1" }), "x".repeat(32));
    expect(response.status).toBe(404);
    expect(response.headers.get("www-authenticate")).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
  });

  test("the header path ignores the url flag", async () => {
    const flagged = unitConfig({ demoUrlFlag: "1" });
    const listed = await mcpResult(await postMcp(flagged, listBody, `Bearer ${UNIT_TOKEN}`));
    expect(listed.status).toBe(200);
    const tools = listed.body.result?.tools as Array<{ name: string }>;
    expect(tools).toHaveLength(TOOL_NAMES.length);

    const missing = await postMcp(flagged, listBody);
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe("Bearer");

    const unflagged = await mcpResult(await postMcp(unitConfig(), listBody, `Bearer ${UNIT_TOKEN}`));
    expect(unflagged.status).toBe(200);
  });
});

describe("mcp tool errors", () => {
  test("invalid input is a tool error from the contract, not a protocol error", async () => {
    const config = unitConfig();
    const token = `Bearer ${UNIT_TOKEN}`;
    const response = await mcpResult(
      await postMcp(
        config,
        rpcBody("tools/call", {
          name: "get_note_pages",
          arguments: {
            fileId: "11111111-1111-4111-8111-111111111111",
            firstPage: 5,
            lastPage: 2,
          },
        }),
        token,
      ),
    );
    expect(response.status).toBe(200);
    const result = response.body.result as { isError?: boolean; content?: Array<{ text?: string }> };
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text?.startsWith("invalid_input")).toBe(true);
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
