# Task: mcp-oauth

Coder for the mcp orchestrator. Branch `agent/mcp-oauth`, worktree `C:/Pluto-mcp-oauth`, PR target `agent/mcp`. Dev port 3302. No migrations.
Build step 3 (MCP server in Claude). Contract items: `docs/plan.md` "MCP contract" Auth line; Stack row "MCP server"; decision log 2026-11-13 "MCP auth: Supabase Auth OAuth 2.1 server (dynamic client registration, consent page `/oauth/consent`)"; decision log 2026-11-14 "the proxy treats every `/api/*`, `/open`, `/oauth`, `/cal` path as public; each such route must authenticate the caller itself".

Read first: `CLAUDE.md`, `orchestrations/files/BRIEF.md`, `orchestrations/plans/mcp.md` (Design), the merged `packages/mcp/src/**`, `apps/web/lib/supabase/{server,fetch}.ts`, `apps/web/lib/public-path.ts`, `supabase/config.toml` section `[auth.oauth_server]`, `apps/web/AGENTS.md` (read the Next docs under `node_modules/next/dist/docs/` before writing pages, route handlers or server actions). Check the current Supabase docs for "OAuth 2.1 server" and "MCP authentication" and the installed `@supabase/supabase-js` types (`auth.oauth.*`, `auth.getClaims`) rather than trusting memory.

## Goal
A standard MCP client (Claude, ChatGPT, MCP Inspector) with no pre-shared token can discover the authorization server from `/api/mcp`, register itself, send the student through Pluto's consent page, and call the tools with a Supabase access token. Every call is scoped to that student by RLS and by the explicit `student_id` filter. The demo bearer keeps working unchanged.

## Files you own
- `packages/mcp/src/auth.ts`, `packages/mcp/src/handler.ts` (only the 401 header and passing config through), new files under `packages/mcp/src/` for OAuth helpers, `packages/mcp/test/**` (new test files; don't weaken existing tests)
- `apps/web/app/.well-known/**`
- `apps/web/app/oauth/**`
- `apps/web/app/api/mcp/route.ts` (config wiring only)
- `packages/mcp/package.json` and `package-lock.json` only if you truly need a new dependency (prefer none)

Do not touch `/login`, `proxy.ts`, `lib/**`, `packages/core/**` or `supabase/**`. If `/login` does not exist yet on this branch (it lands with the web slice), still redirect to it; note it in the PR.

## What to build
1. **Protected resource metadata** (RFC 9728). `GET /.well-known/oauth-protected-resource` and `GET /.well-known/oauth-protected-resource/api/mcp` return JSON:
   `{ "resource": "<APP_URL>/api/mcp", "authorization_servers": ["<SUPABASE_URL>/auth/v1"], "bearer_methods_supported": ["header"], "resource_name": "Pluto" }` with `Cache-Control: no-store` and CORS `Access-Control-Allow-Origin: *` (plus an `OPTIONS` handler). Confirm in the Supabase docs that `<SUPABASE_URL>/auth/v1` is the issuer whose metadata lives at `<SUPABASE_URL>/.well-known/oauth-authorization-server/auth/v1`; use whatever the docs say is correct and state it in the PR. `SUPABASE_URL` here is `NEXT_PUBLIC_SUPABASE_URL`.
2. **401 challenge.** Every 401 from `/api/mcp` carries `WWW-Authenticate: Bearer resource_metadata="<APP_URL>/.well-known/oauth-protected-resource"` (add `error="invalid_token"` when a token was sent but rejected).
3. **JWT verification** in `authenticate`: order is demo bearer first (unchanged), then Supabase access token.
   - Verify with `supabase.auth.getClaims(token)` on an anon-key client (it checks the signature against the project's JWKS for asymmetric keys and falls back to the Auth server for HS256, so local and hosted both work). Reject when it errors, when `sub` is missing, when `role` is not `authenticated`, when `exp` is past, or when `iss` is not `<SUPABASE_URL>/auth/v1`.
   - `studentId` = `sub`. `db` = an anon-key client created with `global.headers.Authorization = "Bearer <token>"`, the 10 s timeout fetch, `persistSession: false`, `autoRefreshToken: false`. Never use the service role on this path.
   - Never log tokens. Never accept tokens from the query string or cookies on `/api/mcp`.
   - `anon` key JWTs and `service_role` JWTs sent as bearer must be rejected (role check); add tests for both.
4. **Consent page** `/oauth/consent` (server component + server actions, mobile first, works at 390px, Tailwind; plain elements are fine if shadcn primitives are not on this branch yet).
   - Reads `authorization_id` from the query. Missing or malformed -> a small error state, no redirect.
   - Not signed in (`supabase.auth.getUser()` on the cookie client from `apps/web/lib/supabase/server.ts`) -> `redirect("/login?next=" + encodeURIComponent("/oauth/consent?authorization_id=" + id))`.
   - Signed in -> `supabase.auth.oauth.getAuthorizationDetails(id)`; show the client name, the redirect host, the scopes, and the signed-in email, with the line "This app will be able to read your courses, notes, deadlines and grades. It cannot change anything." If the details already contain a redirect (consent given before), follow it.
   - Approve -> `approveAuthorization(id)`; Deny -> `denyAuthorization(id)`; both then `redirect` to the URL Supabase returns. Server actions re-check the session and re-read the id from the form, and only redirect to the URL returned by Supabase (never to a URL taken from the request).
   - Errors from Supabase (expired or unknown authorization) -> error state with a "Back to Pluto" link.

## Tests (`packages/mcp/test`, DB-gated like the existing ones)
- Sign in two throwaway students with `signInWithPassword` (anon client) to get real access tokens. Student A's token: `tools/call list_courses` returns A's courses only; every tool returns contract-valid output. Student B's token never returns A's ids or text.
- RLS is really in force on the OAuth path: build the context the handler would build for B, then query `courses` for A's `student_id` directly through that `db` -> zero rows.
- 401 with the `resource_metadata` challenge for: no token, garbage token, a valid token with one character of the signature changed, an expired token (sign one yourself only if the local stack is HS256 and the JWT secret is in env; otherwise mock `getClaims` to return an expired claim set), the anon key, the service-role key.
- Demo bearer still works and still wins when both would match.
- Metadata: unit test for the JSON builder (exact `resource` and `authorization_servers`, no trailing slashes).

## Acceptance checks (paste real output tails in the PR)
```bash
npm install && npm run env:local -- --port 3302   # for the Inspector round trip use port 3000 instead (director decision: Supabase site_url is localhost:3000; check nothing else is listening there first)
npm run typecheck && npm run lint && npm test
npm run build -w @pluto/web
npm run dev   # port 3302, then:
curl -s http://localhost:3302/.well-known/oauth-protected-resource
curl -si -X POST http://localhost:3302/api/mcp -H "Content-Type: application/json" -d '{}' | head -5      # 401 + WWW-Authenticate with resource_metadata
curl -si "http://localhost:3302/oauth/consent?authorization_id=abc" | head -5                              # signed out: redirect to /login?next=...
# real token: sign in demo@pluto.test via the Supabase REST API (password in .env.example), then tools/call list_courses with it -> 3 demo courses
```
Then the full round trip: MCP Inspector (`npx @modelcontextprotocol/inspector`, transport Streamable HTTP, URL `http://localhost:3302/api/mcp`, no token) should register, open the consent page, and after Approve list 7 tools. Run this round trip with the app on port 3000 (`npm run env:local -- --port 3000`), because the local Supabase `site_url` is `http://localhost:3000`; never edit `supabase/**`. Stop the dev server and Inspector when done.

## Rules
- Security-sensitive task: when in doubt, reject the request. Never widen auth to make a test pass.
- Every Supabase call has a timeout and handled errors.
- Commit small; `git push -u origin agent/mcp-oauth` after every commit.
- When done: `gh pr create --base agent/mcp` with summary, contract items touched, output tails, what the Inspector round trip showed, "How to UI-test". Reply `DONE <PR URL>`.
- Anything needing a decision (contract, Supabase config, token audience rules): stop and report.
