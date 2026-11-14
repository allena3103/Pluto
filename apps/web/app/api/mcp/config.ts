import { DEMO_STUDENT_ID, type McpAuthConfig } from "@pluto/mcp/auth";
import type { McpHandlerConfig } from "@pluto/mcp/handler";

/** Env for both MCP routes. Missing server env returns undefined; callers respond, they do not throw at import. */
export function readMcpHandlerConfig(): McpHandlerConfig | undefined {
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
  const demoUrlFlag = process.env.PLUTO_DEMO_MCP_URL_ENABLED;
  if (demoUrlFlag) config.demoUrlFlag = demoUrlFlag;
  return config;
}
