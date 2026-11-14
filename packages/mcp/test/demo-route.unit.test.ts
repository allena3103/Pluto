import { afterEach, describe, expect, test } from "vitest";
import { TOOL_NAMES } from "@pluto/core/contract";
import { ACCEPT, UNIT_TOKEN, mcpResult, rpcBody } from "./request";
import { POST } from "../../../apps/web/app/api/mcp/demo/[token]/route";

const ENV_KEYS = [
  "PLUTO_DEMO_MCP_URL_ENABLED",
  "PLUTO_DEMO_MCP_TOKEN",
  "PLUTO_DEMO_STUDENT_ID",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_URL",
] as const;

const saved = new Map<string, string | undefined>();

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>): void {
  for (const key of ENV_KEYS) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
});

function listRequest(): Request {
  return new Request("http://127.0.0.1:3301/api/mcp/demo/redacted", {
    method: "POST",
    headers: { accept: ACCEPT, "content-type": "application/json" },
    body: rpcBody("tools/list", {}),
  });
}

function unreadToken(): Promise<{ token: string }> {
  return {
    then() {
      throw new Error("path token was read");
    },
  } as unknown as Promise<{ token: string }>;
}

describe("demo url route", () => {
  test("does not read the path token when the flag is unset or the demo token is too short", async () => {
    setEnv({
      PLUTO_DEMO_MCP_URL_ENABLED: undefined,
      PLUTO_DEMO_MCP_TOKEN: UNIT_TOKEN,
    });
    const hidden = await POST(listRequest(), { params: unreadToken() });
    expect(hidden.status).toBe(404);
    await expect(hidden.json()).resolves.toEqual({ error: "not_found" });

    setEnv({
      PLUTO_DEMO_MCP_URL_ENABLED: "1",
      PLUTO_DEMO_MCP_TOKEN: "too-short",
    });
    const short = await POST(listRequest(), { params: unreadToken() });
    expect(short.status).toBe(404);
  });

  test("flag 1 serves tools/list for the right token and 404 for the wrong one", async () => {
    setEnv({
      PLUTO_DEMO_MCP_URL_ENABLED: "1",
      PLUTO_DEMO_MCP_TOKEN: UNIT_TOKEN,
      PLUTO_DEMO_STUDENT_ID: "11111111-1111-4111-8111-111111111111",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-test-key",
      APP_URL: "http://127.0.0.1:3301",
    });

    const listed = await mcpResult(await POST(listRequest(), { params: Promise.resolve({ token: UNIT_TOKEN }) }));
    expect(listed.status).toBe(200);
    const tools = listed.body.result?.tools as Array<{ name: string }>;
    expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());

    const wrong = await POST(listRequest(), { params: Promise.resolve({ token: "x".repeat(32) }) });
    expect(wrong.status).toBe(404);
    expect(wrong.headers.get("www-authenticate")).toBeNull();
    await expect(wrong.json()).resolves.toEqual({ error: "not_found" });
  });
});
