import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { makeToolContext } from "@pluto/core/context";
import { authenticate, type McpAuthConfig, type McpAuthMode } from "./auth";
import { createPlutoMcpServer } from "./server";

export type McpHandlerConfig = McpAuthConfig & {
  /** Web app origin, no trailing slash required. Deep links are built from this. */
  appUrl: string;
};

export type McpRequestOptions = McpAuthMode;

function json(body: { error: string }, status: number, extraHeaders?: HeadersInit): Response {
  return Response.json(body, { status, headers: extraHeaders });
}

/** URL mode must not log the request URL or the token, which may be inside an error message. */
function logFailure(label: string, error: unknown, urlMode: boolean): void {
  if (urlMode) {
    console.error(label);
    return;
  }
  console.error(label, error);
}

/**
 * Stateless streamable HTTP: a new server and
 * `WebStandardStreamableHTTPServerTransport` per request, no session id,
 * JSON responses (`enableJsonResponse`).
 * Auth runs before the transport. GET and DELETE are 405 after a successful auth.
 */
export async function handleMcpRequest(
  request: Request,
  config: McpHandlerConfig,
  options?: McpRequestOptions,
): Promise<Response> {
  const urlMode = options !== undefined;
  let auth: ReturnType<typeof authenticate>;
  try {
    auth = authenticate(request, config, options);
  } catch (error) {
    logFailure("mcp auth failed", error, urlMode);
    return json({ error: "server_error" }, 500);
  }

  if (!auth.ok) {
    if (auth.reason === "not_found") {
      return json({ error: "not_found" }, 404);
    }
    return json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
  }

  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  }

  let ctx;
  try {
    ctx = makeToolContext({ db: auth.db, studentId: auth.studentId, appUrl: config.appUrl });
  } catch (error) {
    logFailure("mcp context failed", error, urlMode);
    return json({ error: "server_error" }, 500);
  }

  const server = createPlutoMcpServer(ctx, { redactErrors: urlMode });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (error) {
    logFailure("mcp request failed", error, urlMode);
    return json({ error: "server_error" }, 500);
  } finally {
    await transport.close().catch((error: unknown) => {
      logFailure("mcp transport close failed", error, urlMode);
    });
    await server.close().catch((error: unknown) => {
      logFailure("mcp server close failed", error, urlMode);
    });
  }
}
