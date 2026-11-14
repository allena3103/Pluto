# MCP plan

Orchestrator: mcp (Claude). Branch `agent/mcp`, worktree `C:/Pluto-mcp`, port 3300 (coders 3301+), migrations `20261114030000`-`20261114035959` (none planned).
Build steps covered: 3 (MCP server in Claude) and 4 (ChatGPT on the same server).
Base: `agent/pluto` at F1 plus the 7 core tool functions. Ingest and seeded note pages (PR #25) arrive later through a sync PR (PROTOCOL 2e); until then tests insert their own files and pages with the helpers in `packages/core/test/tools/helpers.ts`.

## Design

- `packages/mcp` (`@pluto/mcp`, source-only like core): everything testable without Next.
  - `server.ts`: builds an MCP server for one request from a `ToolContext`. Registers the 7 tools from `TOOLS` in `@pluto/core/contract` (name, input schema, output schema) and runs `TOOL_HANDLERS[name](ctx, args)`. Result: `structuredContent` plus the same JSON as text. `ToolError` becomes `isError: true` with the code and message; anything else becomes a generic error (no stack, no SQL).
  - `descriptions.ts`: LLM-facing tool descriptions and server instructions (which note tool to call when, cite `deepLink`, 1-based pages, truncation then `get_note_pages`).
  - `auth.ts`: `authenticate(request, config)` returns `{ studentId, db }` or a 401 reason. Order: demo bearer, then (task 2) Supabase JWT.
  - `handler.ts`: `handleMcpRequest(request, config): Promise<Response>`. Stateless streamable HTTP (no sessions, JSON responses), 401 with `WWW-Authenticate` when auth fails.
- `apps/web/app/api/mcp/route.ts`: thin wrapper, reads env, calls `handleMcpRequest`. `runtime = "nodejs"`.
- Demo bearer: `Authorization: Bearer $PLUTO_DEMO_MCP_TOKEN`, compared in constant time, disabled when the env var is empty or shorter than 24 chars. Maps to the demo student id (`PLUTO_DEMO_STUDENT_ID`, default the seed id `11111111-1111-4111-8111-111111111111`). Uses the service-role client (allowed for this fallback by BRIEF); safety comes from the explicit `student_id` filter in every core function.
- OAuth (task 2): Supabase is the authorization server. `/.well-known/oauth-protected-resource` (and the `/api/mcp` suffixed form) names `<SUPABASE_URL>/auth/v1` as the authorization server. Access tokens verified with `supabase.auth.getClaims` (JWKS for asymmetric keys, server check for HS256, so local and hosted both work). Data access uses an anon-key client carrying the user's token, so RLS applies. `/oauth/consent` approves or denies with the signed-in session.

## Tasks (strictly serial: one coder at a time while free memory is under 2 GB)

| # | Task | Who | Owns | Depends on | Port | Security review |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `mcp-server` | Cursor `grok-4.7-medium` | `packages/mcp/**`, `apps/web/app/api/mcp/**`; one line each in `apps/web/package.json` (dep `@pluto/mcp`) and `apps/web/next.config.ts` (`transpilePackages`); `package-lock.json` | none | 3301 | yes (demo bearer, service role) |
| 2 | `mcp-oauth` | Cursor `grok-4.7-high` | `packages/mcp/src/auth.ts` + its tests, `packages/mcp/src/handler.ts` (401 header only), `apps/web/app/.well-known/**`, `apps/web/app/oauth/**` | 1 merged | 3302 | yes (OAuth, JWT, consent) |
| 3 | sync with `agent/pluto` (PR #25 ingest + seed, web login) | orchestrator, branch `agent/mcp-sync` | merge only; other slices' files take `agent/pluto`'s version | #25 merged into `agent/pluto` | 3300 | no |
| 4 | seeded end-to-end check + milestone PR M1 | orchestrator | `packages/mcp/test/seeded.db.test.ts`, `orchestrations/reports/mcp-M1.md` | 1, 2, 3 | 3300 | no |
| 5 | Claude connect, then ChatGPT (build step 4) | orchestrator + Allen | fixes only, through a new coder if needed | M1 merged, hosted Supabase + Vercel preview | - | - |

Briefs: `orchestrations/tasks/mcp-server.md`, `orchestrations/tasks/mcp-oauth.md` (written when task 1 is in review).

## Acceptance checks

Task 1 `mcp-server`
- `npm run typecheck && npm run lint && npm test` green; `npm run build -w @pluto/web` green.
- `packages/mcp` tests (DB tests gated like core): `tools/list` returns exactly the 7 contract names with input schemas; each tool called through the handler returns contract-valid `structuredContent`; a token for student A never returns student B's rows; no `Authorization`, a wrong token, and an unset `PLUTO_DEMO_MCP_TOKEN` each give 401 with `WWW-Authenticate: Bearer`; `get_recent_notes` over the cap sets `truncated`, then `get_note_pages` from `pagesIncluded + 1` returns the rest; unknown course gives `isError` with the `ToolError` message.
- Live: dev server on 3301, `curl` `initialize` + `tools/list` + `tools/call list_courses` with the demo token returns the demo student's 3 courses; MCP Inspector CLI (`npx @modelcontextprotocol/inspector --cli ... --method tools/list`) lists 7 tools. Dev server stopped afterwards.

Task 2 `mcp-oauth`
- `GET /.well-known/oauth-protected-resource` returns `resource` = `<APP_URL>/api/mcp` and `authorization_servers` = [`<SUPABASE_URL>/auth/v1`].
- 401 carries `WWW-Authenticate: Bearer resource_metadata="<APP_URL>/.well-known/oauth-protected-resource"`.
- A real access token from `signInWithPassword` for `demo@pluto.test` lists the demo courses; one for `other@pluto.test` sees none of them (RLS client, not service role); a tampered or expired token gives 401.
- `/oauth/consent?authorization_id=...` signed out redirects to `/login?next=<same path and query>`; signed in shows the client name and Approve / Deny; works at 390px.
- Full local OAuth round trip with MCP Inspector against local Supabase (dynamic registration, consent, token, 7 tools).

Task 4 (after sync): through the handler as the demo student, `get_recent_notes({ course: "History 105" })` returns seeded files with page text and deep links `/notes/<fileId>?page=<n>`; `search_notes` for a manifest fact returns the expected file and page; `other@pluto.test` sees none of it.

Done for the slice: MCP Inspector lists and calls 7 tools with the demo token and through OAuth locally; Claude builds the History 105 study guide live (Allen confirms).

## Review and merge
- Both coder PRs are labeled `security-review`: fresh headless reviewer first (`cursor-agent.cmd -p --force --trust --model grok-4.7-high`, REVIEW.md, from the coder worktree, one at a time), one fix round, one re-review, then grokbot. Grokbot merges; the orchestrator never merges.
- After each merge into `agent/mcp`: pull, rerun typecheck, lint, test, build here.

## Usage and memory
- Only the orchestrator runs on Claude (meter shared with the foundation planner). Coders and reviewers run on Cursor.
- One coder or one reviewer at a time. No dev server left running after a check. Coder tabs closed once their PR merges.

## Open questions for the director / Allen
1. **Demo fallback in claude.ai.** Claude's custom connector screen takes a URL (and optional OAuth client id/secret), not a custom `Authorization` header. The bearer fallback works in MCP Inspector, Claude Code and Claude Desktop (via `mcp-remote --header`), but not in the claude.ai connector UI. If OAuth sign-in fails at the event and the demo must run in claude.ai, we would need the token in the URL (for example `/api/mcp/t/<token>`). That puts a secret in a URL, so it is a contract and security decision: not built unless the director says so. The handler is shaped so it is a 10-line route.
2. `PLUTO_DEMO_STUDENT_ID` (optional override of the seed id) should be added to `.env.example` by foundation; `PLUTO_DEMO_MCP_TOKEN` is already there.
3. Task 1 adds one line to `apps/web/package.json` and `apps/web/next.config.ts` (foundation-owned) and changes `package-lock.json`.
4. Needed from Allen before Claude can connect: hosted Supabase project with the OAuth 2.1 server and dynamic client registration on, site URL set to the deployed app, migrations and seed applied; a Vercel preview of `agent/pluto` (or `agent/mcp`) with env vars including `APP_URL` and `PLUTO_DEMO_MCP_TOKEN`.
