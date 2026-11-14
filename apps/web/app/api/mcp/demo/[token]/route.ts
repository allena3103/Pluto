import { demoUrlActive } from "@pluto/mcp/auth";
import { handleMcpRequest } from "@pluto/mcp/handler";
import { readMcpHandlerConfig } from "../../config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DemoUrlContext = { params: Promise<{ token: string }> };

function notFound(): Response {
  return Response.json({ error: "not_found" }, { status: 404 });
}

function serverError(): Response {
  return Response.json({ error: "server_error" }, { status: 500 });
}

async function dispatch(request: Request, context: DemoUrlContext): Promise<Response> {
  // Off unless the flag is exactly "1" and the demo token is enabled. Do not read the path token first.
  if (!demoUrlActive(process.env.PLUTO_DEMO_MCP_URL_ENABLED, process.env.PLUTO_DEMO_MCP_TOKEN)) {
    return notFound();
  }
  const config = readMcpHandlerConfig();
  if (!config) return serverError();
  const { token } = await context.params;
  return handleMcpRequest(request, config, { urlToken: token });
}

export function POST(request: Request, context: DemoUrlContext): Promise<Response> {
  return dispatch(request, context);
}

export function GET(request: Request, context: DemoUrlContext): Promise<Response> {
  return dispatch(request, context);
}

export function DELETE(request: Request, context: DemoUrlContext): Promise<Response> {
  return dispatch(request, context);
}
