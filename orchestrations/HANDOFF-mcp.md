# MCP orchestrator handoff (written 2026-11-14, Claude meter ~93%)

For a Cursor planner (`grok-4.7-high`) taking over `agent/mcp` in `C:/Pluto-mcp`. Read `orchestrations/plans/mcp.md` first; follow PROTOCOL 2d (you have no background notifications: block on `herdr agent wait <name> --timeout 900000`).

## State
- `agent/mcp` = `agent/pluto` at F1 + 7 core tool functions, plus the plan, two coder briefs and this file. No MCP code merged yet.
- Plan: `orchestrations/plans/mcp.md`. Briefs: `orchestrations/tasks/mcp-server.md`, `orchestrations/tasks/mcp-oauth.md`.
- No PRs open from this slice yet. Nothing merged. No dev server running in `C:/Pluto-mcp` (no `npm install` done there either; run it before checks).

## Update (after the Claude meter reset)
- PR #27 (`agent/mcp-server` -> `agent/mcp`) is open, CI green, labeled `security-review`. It has `/api/mcp`, the 7 tools, the demo bearer and the URL-token route `/api/mcp/demo/[token]`. Coder tab `mcp-server` (`wF:tK`) is idle.
- Orchestrator checks in `C:/Pluto-mcp-server`: diff read in full (in scope, no core edits); typecheck, lint, `@pluto/mcp` tests (23) and web build pass; live check on 3301 passed (401 + `WWW-Authenticate` without or with a wrong token, query-string token rejected, 7 tools, 3 demo courses, `course_not_found` as `isError`, URL route 404 with the flag off, GET 405). Dev server stopped.
- Local-only failure, not from this PR: `packages/core/test/db/rls.test.ts` "covers every public table" fails because the shared local database has another slice's table. CI is green.
- Fresh review 1 is running from `C:/Pluto-mcp-server` -> `.review/review-1.md` (log `.review/review-1.log`). Next: post it on PR #27 with `gh pr comment 27 --body-file`; APPROVE -> add the verdict to the PR body and leave it for grokbot; CHANGES REQUIRED -> one fix round in tab `mcp-server`, one re-review.

## Running agents (tabs this orchestrator created)
- `mcp-server` (tab `wF:tK`, pane `wF:pK`, Cursor `grok-4.7-medium`, worktree `C:/Pluto-mcp-server`, branch `agent/mcp-server`, port 3301): task 1, `/api/mcp` + 7 tools + demo bearer + URL-token fallback. Started ~spawn time of commit `97be2b2`; working, no commits yet when this was written. It was sent the URL-token addition as a follow-up prompt (see below); confirm it is in its diff.
- Nothing else. `mcp-oauth` is NOT started.

## Director decisions (docs/plan.md commit 8107236 on agent/pluto)
1. URL-token fallback for claude.ai: `/api/mcp/demo/<token>`, same 7 read-only tools, demo student only, enabled only when `PLUTO_DEMO_MCP_URL_ENABLED=1`, constant-time compare with `PLUTO_DEMO_MCP_TOKEN`, off by default. In `mcp-server` scope. OAuth stays primary.
2. Local OAuth round trip: run the web app on port 3000 (Supabase `site_url`); no `supabase/config.toml` change. Make sure nobody else's dev server holds 3000 first, and stop it after.
3. Approved: additive edits to `apps/web/package.json`, `apps/web/next.config.ts`, `package-lock.json`, and `PLUTO_DEMO_STUDENT_ID` + `PLUTO_DEMO_MCP_URL_ENABLED` in `.env.example`. List them in the PR body.

## Next steps, in order
1. When `mcp-server` goes idle: `herdr agent read mcp-server --source recent-unwrapped --lines 80`. If it replied `DONE <PR URL>`:
   - Read the whole diff (`git -C C:/Pluto-mcp-server diff agent/mcp...HEAD`). Check: files only in its scope; auth runs before any tool; token compare is constant time; service-role client created only after a token match; URL route returns 404 (not 401) when `PLUTO_DEMO_MCP_URL_ENABLED` is not `1`; no token in logs; no query-string tokens; errors don't leak stacks or SQL.
   - Rerun in its worktree: `npm run typecheck && npm run lint && npm test && npm run build -w @pluto/web`. Do the live curl check from the brief on port 3301, then stop the dev server.
   - `gh label create security-review` (once, it does not exist yet), `gh pr edit <pr> --add-label security-review`.
   - Fresh review (PowerShell, from `C:/Pluto-mcp-server`, one at a time): write `.review/diff.patch`, then `cursor-agent.cmd -p --force --trust --model grok-4.7-high "You are a fresh reviewer. Follow REVIEW.md exactly. Goals and acceptance checks: orchestrations/tasks/mcp-server.md. Diff: .review/diff.patch (base agent/mcp). Write your report to .review/review-1.md and print it."`; post with `gh pr comment <pr> --body-file`. CHANGES REQUIRED: one fix round by the coder, one re-review, then escalate (`orchestrations/escalations/mcp-<n>.md`).
   - CI green + APPROVE stated in the PR body; grokbot merges. Never merge yourself.
2. After merge: `git pull` in `C:/Pluto-mcp`, `npm install`, rerun typecheck/lint/test/build. Close tab `wF:tK`; remove `C:/Pluto-mcp-server` only if clean and merged.
3. Spawn `mcp-oauth` (Cursor `grok-4.7-high`, worktree `C:/Pluto-mcp-oauth`, brief already written) per PROTOCOL 2: `herdr agent start mcp-oauth --kind cursor --pane <pane> -- --force --trust --model grok-4.7-high`. One coder at a time while free memory is under 2 GB. Same review flow, label `security-review`.
4. When PR #25 (ingest + seeded pages) is in `agent/pluto`: sync PR `agent/mcp-sync` -> `agent/mcp` per PROTOCOL 2e (take `agent/pluto`'s version for files we don't own).
5. Add `packages/mcp/test/seeded.db.test.ts` (demo student through the handler: `get_recent_notes` for History 105 returns seeded pages with deep links; `search_notes` for a `seed/pdfs/manifest.json` fact returns the right file and page; `other@pluto.test` sees none). Write `orchestrations/reports/mcp-M1.md` (BRIEF "Final report"), open the milestone PR into `agent/pluto`.
6. Report to the director "Claude can be connected" only when: M1 is merged, the Vercel preview answers `tools/list` with the demo token, and `/.well-known/oauth-protected-resource` on the preview points at the hosted Supabase. Give Allen the connector URL `https://<preview>/api/mcp` (OAuth) and the fallback `https://<preview>/api/mcp/demo/<token>` (only if `PLUTO_DEMO_MCP_URL_ENABLED=1`).
7. ChatGPT (build step 4): same URL; done when it lists courses; stop after ~1 hour of trouble and report.

## Waiting on Allen (director is asking)
Hosted Supabase (OAuth 2.1 server + dynamic client registration on, site URL = deployed app, migrations + seed applied) and a Vercel preview with env vars (`APP_URL`, `NEXT_PUBLIC_APP_URL`, Supabase keys, `PLUTO_DEMO_MCP_TOKEN`, optionally `PLUTO_DEMO_MCP_URL_ENABLED=1`).

## Notes
- Free memory was 0.67 GB at spawn. One coder or one reviewer at a time; stop every dev server after checks.
- Cursor panes may paste a prompt without submitting: `herdr agent send-keys <name> enter` once.
- Shared Supabase stack runs from `C:/Pluto-foundation`; never reset or stop it.
