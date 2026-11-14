import { handleMcpRequest, type McpHandlerConfig, type McpRequestOptions } from "../src/handler";

export const ACCEPT = "application/json, text/event-stream";

export const UNIT_TOKEN = "pluto-demo-token-unit-test-32ch";

/** 401 challenge for the unit app URL. */
export const CHALLENGE = 'Bearer resource_metadata="http://127.0.0.1:3301/.well-known/oauth-protected-resource"';
export const INVALID_CHALLENGE =
  'Bearer error="invalid_token", resource_metadata="http://127.0.0.1:3301/.well-known/oauth-protected-resource"';

export function unitConfig(overrides: Partial<McpHandlerConfig> = {}): McpHandlerConfig {
  return {
    supabaseUrl: "http://127.0.0.1:9",
    supabaseAnonKey: "anon-test-key",
    supabaseServiceRoleKey: "service-test-key",
    appUrl: "http://127.0.0.1:3301",
    demoToken: UNIT_TOKEN,
    demoStudentId: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  };
}

export function rpcBody(method: string, params: unknown, id = 1): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

export async function postMcp(
  config: McpHandlerConfig,
  body: string,
  authorization?: string,
  url = "http://127.0.0.1:3301/api/mcp",
  options?: McpRequestOptions,
): Promise<Response> {
  const headers = new Headers({
    accept: ACCEPT,
    "content-type": "application/json",
  });
  if (authorization !== undefined) headers.set("authorization", authorization);
  return handleMcpRequest(new Request(url, { method: "POST", headers, body }), config, options);
}

export async function mcpResult(response: Response): Promise<{
  status: number;
  body: {
    result?: Record<string, unknown>;
    error?: { message?: string };
  };
}> {
  const body = (await response.json()) as {
    result?: Record<string, unknown>;
    error?: { message?: string };
  };
  return { status: response.status, body };
}
