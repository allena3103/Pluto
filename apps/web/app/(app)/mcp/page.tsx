import { headers } from "next/headers";
import { Cable } from "lucide-react";
import { McpConnect } from "@/components/mcp/mcp-connect";
import { PageShell } from "@/components/page-shell";
import { mcpServerUrl } from "@/lib/mcp-connect";

export const dynamic = "force-dynamic";

export const metadata = { title: "MCP · Pluto" };

/**
 * The deployed origin. `APP_URL` wins because the OAuth resource metadata is
 * built from it, so the URL a student copies matches what the server announces.
 */
async function appOrigin(): Promise<string> {
  const configured = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function McpPage() {
  const serverUrl = mcpServerUrl(await appOrigin());

  return (
    <PageShell
      title="Connect your AI"
      description="Pluto's MCP server lets Claude, ChatGPT, Cursor and other agents read your notes, deadlines and grades."
      icon={Cable}
      tint="lilac"
    >
      <McpConnect serverUrl={serverUrl} />
    </PageShell>
  );
}
