# Task: mcp-server

Coder for the mcp orchestrator. Branch `agent/mcp-server`, worktree `C:/Pluto-mcp-server`, PR target `agent/mcp`. Dev port 3301. No migrations.
Build step 3 (MCP server in Claude). Contract items: the 7 MCP tools in `docs/plan.md` "MCP contract" and `packages/core/src/contract.ts` (`TOOLS`); decision log 2026-11-13 "MCP auth ... fallback bearer `PLUTO_DEMO_MCP_TOKEN`".

Read first: `CLAUDE.md`, `orchestrations/files/BRIEF.md`, `orchestrations/plans/mcp.md` (Design), `packages/core/src/contract.ts`, `packages/core/src/context.ts`, `packages/core/src/tools/index.ts`, `apps/web/AGENTS.md` (this Next.js version differs from older ones: read the route-handler docs under `node_modules/next/dist/docs/` before writing the route).

## Goal
`POST /api/mcp` serves the 7 read-only Pluto tools over MCP streamable HTTP, authenticated by `Authorization: Bearer $PLUTO_DEMO_MCP_TOKEN`, which maps to the demo student. OAuth comes in the next task; shape the auth code so a second method slots in.

## Files you own
- `packages/mcp/**` (new workspace package `@pluto/mcp`, source-only, same layout as `packages/core`: `package.json` with `exports`, `tsconfig.json`, `vitest.config.ts`, `src/`, `test/`, scripts `typecheck`, `lint`, `test`)
- `apps/web/app/api/mcp/**`
- Exactly one line each in `apps/web/package.json` (dependency `"@pluto/mcp": "*"`) and `apps/web/next.config.ts` (add `"@pluto/mcp"` to `transpilePackages`)
- `package-lock.json` (only through `npm install` of your new deps)

Do not touch anything else. `packages/core/**` is read-only: if a core function is wrong, stop and report it. Import core by subpath (`@pluto/core/contract`, `@pluto/core/tools/index`, `@pluto/core/context`), never through `@pluto/core`'s `index.ts`.

## What to build
1. `packages/mcp/src/server.ts`: `createPlutoMcpServer(ctx: ToolContext)` using the official `@modelcontextprotocol/sdk` (current 1.x). Register every entry of `TOOLS`: name from the contract, input schema and output schema from the contract's zod schemas (zod 4; if the SDK can't take a schema directly, e.g. the refined `GetNotePagesInput`, convert with `z.toJSONSchema` and register through the low-level `Server` request handlers instead; the published JSON schema must still show `fileId`, `firstPage`, `lastPage`). Mark every tool `readOnlyHint: true`. Each call runs `TOOL_HANDLERS[name](ctx, args)` (it validates input and output itself). Return `structuredContent` and the same object as JSON text content. `ToolError` -> `{ isError: true }` with text `"<code>: <message>"`. Any other error -> `isError` with a generic message; log the real error server-side, never return stacks or SQL.
2. `packages/mcp/src/descriptions.ts`: LLM-facing descriptions (start from `TOOLS[name].description`, extend) and server `instructions`. They must tell the model: call `list_courses` first when the course is unclear; `get_recent_notes` for "notes from the past N days/weeks" and study guides; if `truncated` is true, call `get_note_pages({ fileId, firstPage: pagesIncluded + 1 })` for each file with `pagesIncluded < pageCount`; `search_notes` to find where a topic is covered; pages are 1-based; cite every fact with the page's `deepLink` as a markdown link.
3. `packages/mcp/src/auth.ts`: `authenticate(request, config)` -> `{ ok: true, studentId, db, method: "demo" }` or `{ ok: false, reason }`. Demo bearer rules:
   - Enabled only when `config.demoToken` is set and at least 24 characters. Otherwise every request is 401.
   - Compare with `crypto.timingSafeEqual` on SHA-256 digests of both values (no length leak, no early exit).
   - Student id = `config.demoStudentId` (the route passes `PLUTO_DEMO_STUDENT_ID` or the seed default `11111111-1111-4111-8111-111111111111`).
   - `db` = a service-role Supabase client created only after the token matched (`persistSession: false`, `autoRefreshToken: false`, and a fetch wrapper with a 10 s timeout like `apps/web/lib/supabase/fetch.ts`). Never log the token or the key.
   - Accept only the `Authorization` header. No query-string or cookie tokens.
4. `packages/mcp/src/handler.ts`: `handleMcpRequest(request: Request, config): Promise<Response>`. Stateless: a fresh server and transport per request, no session ids, JSON responses (use the SDK's web-standard streamable HTTP transport if the installed version has one; otherwise `mcp-handler`; say which in the PR). Auth runs before anything else; failure -> `401` JSON body `{ "error": "unauthorized" }` with header `WWW-Authenticate: Bearer` (task 2 adds `resource_metadata`). `GET`/`DELETE` -> 405 after auth. Build the `ToolContext` with `makeToolContext({ db, studentId, appUrl })`.
5. `apps/web/app/api/mcp/route.ts`: `export const runtime = "nodejs"`, `dynamic = "force-dynamic"`; exports `POST`, `GET`, `DELETE` delegating to `handleMcpRequest` with config from env (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`, `PLUTO_DEMO_MCP_TOKEN`, `PLUTO_DEMO_STUDENT_ID`). Missing server env -> 500 with a generic body, not a crash at import time. The proxy already treats `/api/*` as public, so this route is the only auth.

6. **URL-token fallback for claude.ai** (director decision, `docs/plan.md` commit 8107236; claude.ai connectors cannot send a custom header). `apps/web/app/api/mcp/demo/[token]/route.ts`: same handler, same 7 read-only tools, demo student only.
   - Enabled only when `PLUTO_DEMO_MCP_URL_ENABLED` is exactly `1` AND `PLUTO_DEMO_MCP_TOKEN` is set and at least 24 chars. Otherwise respond `404` with a generic body before looking at the token (off by default).
   - Path token compared with the same constant-time function as the header token. Mismatch -> `404` (no `WWW-Authenticate`, so clients don't start OAuth against this URL).
   - Implement as a second auth method in `packages/mcp` (`method: "demo-url"`, e.g. `handleMcpRequest(request, config, { urlToken })`), not a copy of the handler. Never log the URL or the token; never echo the token in a response.
   - Tests: flag unset -> 404 with the right token; flag `1` + right token -> `tools/list` has 7 tools and calls are scoped to the demo student; flag `1` + wrong token -> 404; the header path is unchanged by the flag.
   - Also approved: add `PLUTO_DEMO_STUDENT_ID=` and `PLUTO_DEMO_MCP_URL_ENABLED=` (with one-line comments, both empty) to the MCP section of `.env.example`. List every file outside `packages/mcp` and `apps/web/app/api/mcp` in the PR body.

## Tests (`packages/mcp/test`, vitest)
Drive `handleMcpRequest` with real `Request` objects (JSON-RPC `initialize`, `tools/list`, `tools/call`). DB tests use the same gate as core (`describe.skipIf(SKIP_DB_TESTS)`; copy the tiny gate and the `.env.local` loader from `packages/core/test/db-env.ts` and `test/setup.ts` into your package), create their own two students with unique emails plus courses, files and pages (see `packages/core/test/tools/helpers.ts` and `packages/core/test/db/helpers.ts` for how; copy what you need, don't edit core), and delete them afterwards. Set `fileParallelism: false`.
- `tools/list`: exactly the 7 names in `TOOL_NAMES`, each with a description and an input schema.
- Every tool called once as student A returns `structuredContent` that parses with `TOOLS[name].output`, and note results carry `deepLink` starting with the configured `appUrl`.
- Isolation: with the demo token mapped to student A, no result contains any id or text of student B's rows (B has its own course, file, pages, assignment).
- 401 + `WWW-Authenticate` header for: no header, wrong token, right token when `demoToken` is unset, right token when `demoToken` is shorter than 24 chars, `Basic` scheme. No tool runs in those cases.
- Truncation: a file set over `RECENT_NOTES_TEXT_CAP_CHARS` -> `truncated: true`; `get_note_pages` from `pagesIncluded + 1` returns the remaining pages in order.
- Unknown course -> `isError: true`, text starts with `course_not_found`.
- Unit (no DB): token comparison, description text mentions `get_note_pages` and `deepLink`.

## Acceptance checks (paste real output tails in the PR)
```bash
npm install
npm run env:local -- --port 3301      # writes apps/web/.env.local from the shared local stack
npm run typecheck && npm run lint && npm test
npm run build -w @pluto/web
```
Live check (add `PLUTO_DEMO_MCP_TOKEN=<32+ random chars>` to your `apps/web/.env.local`, which is gitignored; if the demo student is missing locally, `npm run seed` is safe to run):
```bash
npm run dev    # port 3301
curl -s -X POST http://localhost:3301/api/mcp -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_courses","arguments":{}}}'
# expect the demo student's 3 courses (History 105, Biology 151, Statistics 240)
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3301/api/mcp -H "Content-Type: application/json" -d '{}'   # expect 401
npx @modelcontextprotocol/inspector --cli http://localhost:3301/api/mcp --transport http --header "Authorization: Bearer $TOKEN" --method tools/list   # expect 7 tools
```
Stop the dev server as soon as the live check is done (memory is tight on this machine). Never run `supabase db reset` or `supabase stop`.

## Rules
- Mocks: none needed. No real keys.
- Every Supabase call has the timeout fetch and handled errors.
- Commit small; `git push -u origin agent/mcp-server` after every commit.
- When done: `gh pr create --base agent/mcp` with summary, build step and contract items touched, the output tails above, which transport you used, and "How to UI-test". Then reply `DONE <PR URL>`.
- If something needs a decision (contract mismatch, a core bug, anything about widening auth), stop and say so instead of guessing.
