import { handleMcpRequest } from "@pluto/mcp/handler";
import { readMcpHandlerConfig } from "./config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serverError(): Response {
  return Response.json({ error: "server_error" }, { status: 500 });
}

async function dispatch(request: Request): Promise<Response> {
  const config = readMcpHandlerConfig();
  if (!config) return serverError();
  return handleMcpRequest(request, config);
}

export function POST(request: Request): Promise<Response> {
  return dispatch(request);
}

export function GET(request: Request): Promise<Response> {
  return dispatch(request);
}

export function DELETE(request: Request): Promise<Response> {
  return dispatch(request);
}
