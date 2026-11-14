import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { makeToolContext } from "@pluto/core/context";
import { authenticate, type McpAuthConfig } from "./auth";
import { createPlutoMcpServer } from "./server";

export type McpHandlerConfig = McpAuthConfig & {
  /** Web app origin, no trailing slash required. Deep links are built from this. */
  appUrl: string;
};

function json(body: { error: string }, status: number, extraHeaders?: HeadersInit): Response {
  return Response.json(body, { status, headers: extraHeaders });
}

/**
 * Stateless streamable HTTP: a new server and
 * `WebStandardStreamableHTTPServerTransport` per request, no session id,
 * JSON responses (`enableJsonResponse`).
 * Auth runs before the transport. GET and DELETE are 405 after a successful auth.
 */
export async function handleMcpRequest(request: Request, config: McpHandlerConfig): Promise<Response> {
  let auth: ReturnType<typeof authenticate>;
  try {
    auth = authenticate(request, config);
  } catch (error) {
    console.error("mcp auth failed", error);
    return json({ error: "server_error" }, 500);
  }

  if (!auth.ok) {
    return json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
  }

  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  }

  let ctx;
  try {
    ctx = makeToolContext({ db: auth.db, studentId: auth.studentId, appUrl: config.appUrl });
  } catch (error) {
    console.error("mcp context failed", error);
    return json({ error: "server_error" }, 500);
  }

  const server = createPlutoMcpServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (error) {
    console.error("mcp request failed", error);
    return json({ error: "server_error" }, 500);
  } finally {
    await transport.close().catch((error: unknown) => {
      console.error("mcp transport close failed", error);
    });
    await server.close().catch((error: unknown) => {
      console.error("mcp server close failed", error);
    });
  }
}
