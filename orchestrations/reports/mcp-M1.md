# MCP milestone M1 report

Orchestrator: mcp. Branch `agent/mcp`. Timeline row: Sat 14:00, "Claude connected via the demo URL token; study guide with page citations works on the deployed app". Written Sat 2026-11-14 ~11:45 EST.

## 1. What is done
Build step 3 (MCP server in Claude), demo-token part. OAuth (the 21:00 row) and ChatGPT (step 4) are not in this milestone.

| Item | State | Done-when check |
| --- | --- | --- |
| `POST /api/mcp`, streamable HTTP, stateless, 7 read-only tools from `contract.ts` | merged (PR #27) | MCP Inspector CLI lists 7 tools; every tool returns contract-valid `structuredContent` |
| Demo bearer `Authorization: Bearer $PLUTO_DEMO_MCP_TOKEN` -> demo student | merged (PR #27) | 401 + `WWW-Authenticate: Bearer` without it; 3 demo courses with it |
| URL-token route `/api/mcp/demo/<token>` for claude.ai, on only when `PLUTO_DEMO_MCP_URL_ENABLED=1` | merged (PR #27) | 404 with the flag off or a wrong token; same 7 tools with the flag on |
| Sync with `agent/pluto` (F2: ingest, seeded PDFs) | sync PR #37 | checks below |
| Seeded demo path through the handler | `packages/mcp/test/seeded.db.test.ts` | `get_recent_notes("History 105")` returns the last-14-days lectures from `seed/pdfs/manifest.json`, every page with its fact and deep link `/notes/<fileId>?page=<n>`; `search_notes` returns the right file and page; the other seeded student gets `course_not_found` / `file_not_found` and no demo file ids |
| Claude builds the study guide live | NOT done yet | needs the deployed app reachable without Vercel SSO (see 5) |

How it is built: `packages/mcp` (`server.ts`, `auth.ts`, `handler.ts`, `descriptions.ts`) holds everything; the two Next routes are thin wrappers. A fresh MCP server and transport per request (`WebStandardStreamableHTTPServerTransport`, JSON responses, no sessions). Auth runs before anything else. The demo methods use a service-role client created only after the token matched; every core tool filters by `student_id`.

## 2. Contract items touched
- The 7 MCP tools (names, inputs, outputs taken from `TOOLS`; nothing changed in `contract.ts`).
- Decision log 2026-11-13 MCP auth (demo bearer fallback) and the director's 2026-11-14 URL-token decision (commit 8107236).
- Shared files, approved by the director: `apps/web/package.json` (+`@pluto/mcp`), `apps/web/next.config.ts` (`transpilePackages`), `package-lock.json`, `.env.example` (`PLUTO_DEMO_STUDENT_ID`, `PLUTO_DEMO_MCP_URL_ENABLED`).

## 3. Checks run (by the orchestrator, on the sync branch = `agent/mcp` + `agent/pluto` 9c82365, plus the seeded test)
```
npm run typecheck   -> exit 0
npm run lint        -> exit 0
npm run smoke       -> PASS 00-core.ts / smoke: 1/1 files passed
npm run build -w @pluto/web -> ok; routes: ƒ /api/mcp, ƒ /api/mcp/demo/[token]
npm test
  @pluto/web   Test Files 2 passed (2)   Tests 9 passed (9)
  @pluto/mcp   Test Files 6 passed (6)   Tests 30 passed (30)
  @pluto/core  Test Files 1 failed | 16 passed (17)   Tests 1 failed | 181 passed (182)
     FAIL test/db/rls.test.ts > row-level security > covers every public table and every table has RLS on
```
The one core failure is local only: the shared local database has `phone_link_codes` from the assistant slice, which the table list in that test does not know yet. It fails the same way on `agent/pluto` locally; CI starts a fresh stack and is green.

Manual exercise (PR #27 head, dev server on 3301, stopped afterwards): no token, wrong token and a query-string token -> 401; demo bearer -> 7 tools, 3 demo courses; unknown course -> `isError` `course_not_found: ...`; URL route with the flag off -> 404; `GET` with the token -> 405. The fresh reviewer repeated this with the flag on (URL route 200, wrong path token 404 without `WWW-Authenticate`) and ran MCP Inspector CLI (7 tools, 0 schema errors).

## 4. Reviewer verdicts
- PR #27 `mcp-server` (`security-review`): fresh review (Cursor `grok-4.7-high`, REVIEW.md, head `e38db0f`) `VERDICT: APPROVE`. Grokbot's one request (redact tool-error logs in URL mode) was fixed in `e38db0f` before the fresh review. Grokbot merged it (b611efc).
- Two NON-BLOCKING notes still open: (a) `next dev` prints `/api/mcp/demo/<token>` in its development request log; (b) `ToolError` `db_error` causes are not logged server-side.
- PR #37 sync: no fresh review (no new code; one lockfile conflict resolved by regenerating with `npm install`).

## 5. Open issues, risks, decisions needed
1. **Deployment Protection.** `*.vercel.app` URLs redirect to Vercel SSO, so Claude cannot reach `/api/mcp`. Needs Allen: a production domain with protection off for it.
2. **Vercel env for the 14:00 row:** `PLUTO_DEMO_MCP_TOKEN` (32+ random chars), `PLUTO_DEMO_MCP_URL_ENABLED=1`, `APP_URL` = the public origin (deep links are built from it), Supabase URL and keys. The hosted database needs the seed (`npm run seed` against it) so the demo student id is `11111111-1111-4111-8111-111111111111`; otherwise set `PLUTO_DEMO_STUDENT_ID`.
3. **The URL token is a secret in a URL.** Platform access logs will record it. Turn the flag off (or rotate the token) once OAuth works.
4. **Deep links open `/notes/<fileId>?page=<n>`**, which is the web slice's page (PR #24, still a draft). Until it is on the deployed app, citations in the study guide are correct links that land on a 404 or the login page.
5. Asking the director: OK to add `logging.incomingRequests.ignore` for `/api/mcp/demo/` in the shared `apps/web/next.config.ts` (note 4a)?
6. Memory: the headless reviewer and one background wait were killed by Claude Code's low-memory reaper. Reviews now run as an interactive Cursor agent in a visible tab (~20 minutes each).
7. Next: `mcp-oauth` coder (brief `orchestrations/tasks/mcp-oauth.md`), then ChatGPT.

## 6. How grokbot should UI-test it
Needs a deployment reachable without SSO, with the env from 5.2. `$APP` = its origin, `$TOKEN` = `PLUTO_DEMO_MCP_TOKEN`.
```bash
H='-H Content-Type:application/json -H Accept:application/json,text/event-stream'
curl -s -o /dev/null -w "%{http_code}\n" -X POST $APP/api/mcp $H -d '{}'                                  # 401
curl -s -X POST $APP/api/mcp $H -H "Authorization: Bearer $TOKEN" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'   # 7 tools
curl -s -X POST $APP/api/mcp/demo/$TOKEN $H -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_recent_notes","arguments":{"course":"History 105"}}}'
# -> History 105 lectures from the last 14 days, each page with text and a deepLink $APP/notes/<fileId>?page=<n>
curl -s -o /dev/null -w "%{http_code}\n" -X POST $APP/api/mcp/demo/wrong-token $H -d '{}'                 # 404
```
In Claude (claude.ai -> Settings -> Connectors -> Add custom connector): URL `$APP/api/mcp/demo/$TOKEN`, no OAuth fields. Then ask: "Build me a study guide from my History 105 notes from the past 2 weeks, use Pluto." Expected: Claude calls `get_recent_notes` (and `get_note_pages` if truncated) and writes a guide whose citations are links to `$APP/notes/<fileId>?page=<n>`.
