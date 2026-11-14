import { DEMO_STUDENT_ID, type McpAuthConfig } from "@pluto/mcp/auth";
import { handleMcpRequest, type McpHandlerConfig } from "@pluto/mcp/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serverConfig(): McpHandlerConfig | undefined {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appUrl = process.env.APP_URL;
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey || !appUrl) {
    return undefined;
  }
  const config: McpAuthConfig & { appUrl: string } = {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    appUrl,
    demoStudentId: process.env.PLUTO_DEMO_STUDENT_ID || DEMO_STUDENT_ID,
  };
  const demoToken = process.env.PLUTO_DEMO_MCP_TOKEN;
  if (demoToken) config.demoToken = demoToken;
  return config;
}

function serverError(): Response {
  return Response.json({ error: "server_error" }, { status: 500 });
}

async function dispatch(request: Request): Promise<Response> {
  const config = serverConfig();
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
