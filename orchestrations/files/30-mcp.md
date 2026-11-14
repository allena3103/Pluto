# Orchestrator: mcp

Branch `agent/mcp`, worktree `C:/Pluto-mcp`, port 3300, migrations `20261114030000`-`20261114035959`. Starts after F2 merges. Follow `orchestrations/files/PROTOCOL.md`. Build steps 3 and 4. This is the demo moment; it has top priority.

## Scope
1. **MCP endpoint** `/api/mcp` in `apps/web` (streamable HTTP, official TypeScript MCP SDK; a Vercel-friendly adapter such as `mcp-handler` is fine). Register the 7 read-only tools from `contract.ts`, each calling the core function with `{ db, studentId }` from the verified token. Tool descriptions written for an LLM: when to call `get_recent_notes` vs `get_note_pages` vs `search_notes`, and that results include deep links to cite.
2. **Auth, demo-safe order:**
   a. Fallback first: `Authorization: Bearer $PLUTO_DEMO_MCP_TOKEN` maps to the demo student. Ship this first so the demo is never blocked.
   b. Supabase OAuth 2.1 server: protected resource metadata at `/.well-known/oauth-protected-resource` pointing at the Supabase authorization server, `WWW-Authenticate` on 401, JWT verification of Supabase access tokens, consent page `/oauth/consent` (uses `getAuthorizationDetails` / `approveAuthorization` / `denyAuthorization`, redirects to `/login?next=...` when signed out). Data access with the user's token so RLS applies.
3. **Connect Claude** as a custom connector against a public HTTPS URL (Vercel preview or a tunnel). Done when Claude builds a study guide from the seeded History 105 notes with page citations that open the right page. Tell the director immediately so Allen can record the backup video.
4. **ChatGPT** on the same server: done when ChatGPT lists courses. If it fights back after ~1 hour, stop and report.
5. **Tests:** every tool scoped to the token's student; `other@pluto.test` token never sees demo data; invalid/expired token -> 401 with `WWW-Authenticate`; `get_recent_notes` truncation then `get_note_pages` continuation.

## Needs from Allen (via director)
Hosted Supabase project with OAuth server enabled, Vercel deployment with env vars, and Allen in front of Claude/ChatGPT to click "Connect". Use MCP Inspector (`npx @modelcontextprotocol/inspector`) locally until then.

## Done when
- MCP Inspector lists 7 tools and calls each successfully with the demo token and via OAuth locally.
- Claude produces the study guide live (Allen confirms).
