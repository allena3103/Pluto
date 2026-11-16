# Pluto handoff: work left (Sat 2026-11-14, ~12:15 EST)

For the next Claude Code account and its subagents. Submission is ~Sun 2026-11-15 09:00 EST; feature freeze Sun 03:00.

Read in this order: `CLAUDE.md` (root), `docs/plan.md` (contract + decision log at the bottom), `orchestrations/files/BRIEF.md` (timeline, ownership, ports, migration ranges), `orchestrations/files/PROTOCOL.md`, then this file, then the per-slice handoffs:

| Slice | Branch | Handoff file (on that branch) |
| --- | --- | --- |
| web | `agent/web` | `orchestrations/HANDOFF-web.md` |
| mcp | `agent/mcp` | `orchestrations/HANDOFF-mcp.md` |
| assistant | `agent/assistant` | `orchestrations/HANDOFF-assistant.md` |
| canvas | `agent/canvas` | section "Canvas" below (written by the director; the canvas planner was stopped before it wrote one) |
| foundation | `agent/foundation` (retired, fully merged) | `orchestrations/reports/foundation-final.md` |

## 1. Where things stand

**On `main` (deployed by Vercel, production build succeeds):** F1 + F2 = monorepo, Supabase schema with RLS and hardening, seed, `contract.ts`, the 7 core tool functions, PDF ingest + full-text search, core helpers (magic links, `sendSms`, ICS), smoke script, web shell scaffold. `main` = `1654c5c`, same content as `agent/pluto` (`9c82365`) plus docs.

**Not on `agent/pluto` yet (still on slice branches):**

| Slice | Merged into its branch | Open PRs into its branch | Never started |
| --- | --- | --- | --- |
| web (19 commits ahead) | login/shell/PWA (#23), grades + deadlines (#13), `/signup` (#34) | #24 notes list + PDF viewer, #36 chat screen (both CI green, no security label, waiting on grokbot) | `/open/[token]`, `/settings/phone`, polish |
| mcp (7 ahead) | `/api/mcp`, 7 tools, demo bearer, demo URL-token route (#27) | #37 sync of `agent/pluto` into `agent/mcp` (green, waiting on grokbot) | M1 milestone PR, OAuth, ChatGPT |
| assistant (5 ahead) | Gemini agent loop `packages/agent` (#28), phone link codes + `POST /api/sms/link-code` (#29) | none | `/api/chat`, `/api/agent/reply`, `/api/magic-link`, `/api/sms/inbound`, `/sms-sim`, `/api/alerts/demo`, `/cal/[token].ics` |
| canvas (16 ahead) | typed client (#12, #21), token route (#22), pagination-origin fix (#26), client fixes #15-#19 (#32) | #38 sync route (BLOCKED, see Canvas) | deadline-change alert route, PDF download + ingest of synced files |

Nothing from web, mcp, assistant or canvas has had a milestone PR into `agent/pluto`.

## 2. Blockers only Allen can clear (do these first)

1. **Hosted database is empty.** `courses`, `file_pages`, `profiles` return 404 on the hosted project. Migrations and seed were never applied. Needs `SUPABASE_ACCESS_TOKEN` or `HOSTED_SUPABASE_DB_URL` in `C:/Pluto/.env.secrets`; then `npx supabase link --project-ref $SUPABASE_PROJECT_REF`, `npx supabase db push`, and run the seed against the hosted project (`npm run seed` with hosted env; it uploads and ingests the PDFs). Set `DEMO_STUDENT_PASSWORD` / `OTHER_STUDENT_PASSWORD` first. The hosted OAuth server, dynamic client registration, consent path and "email confirmation off" are already set.
2. **Vercel Deployment Protection.** `pluto-sepia.vercel.app` and every preview URL redirect to `vercel.com/sso-api`, so Claude/ChatGPT can't reach `/api/mcp` and grokbot can't UI-test previews. Turn off Vercel Authentication (at least for production) and record the production domain.
3. **Vercel env vars** (Production + Preview), names from `.env.example`. Use the `PROD_*` values in `C:/Pluto/.env.secrets` for `INTERNAL_API_SECRET`, `CANVAS_TOKEN_KEY`, `PLUTO_DEMO_MCP_TOKEN` (drop the `PROD_` prefix). Also `PLUTO_DEMO_MCP_URL_ENABLED=1` for the demo, `APP_URL` and `NEXT_PUBLIC_APP_URL` = the public origin, hosted Supabase URL/anon/service-role keys, `GEMINI_API_KEY`, `GEMINI_MODEL`, `PLUTO_LLM=gemini`, Sendblue keys, `SMS_PROVIDER=sendblue`.

## 3. Critical path to the demo (in order)

1. Clear section 2.
2. Grokbot merges #37 (mcp sync). Then follow `HANDOFF-mcp.md` "Exact next steps" 1-3: bring in `agent/mcp-m1` (seeded History 105 test + `orchestrations/reports/mcp-M1.md`), rerun checks, open the M1 milestone PR `agent/mcp` -> `agent/pluto` (merge commit).
3. After M1 merges: PR `agent/pluto` -> `main`, Allen merges, Vercel deploys.
4. Connect Claude with `https://<domain>/api/mcp/demo/<PLUTO_DEMO_MCP_TOKEN>`; ask "build me a study guide from my History 105 notes from the past 2 weeks, use Pluto". **Record the backup video immediately.**
5. Citations point at `/notes/<fileId>?page=<n>`: web #24 must be on `main` for those links to open a viewer. Get #24 merged and a web milestone out right after.

## 4. Remaining work by slice (cut from the bottom if short on time)

Timeline targets from BRIEF are now behind by ~3 hours; re-plan against the 03:00 freeze.

### web (`HANDOFF-web.md`)
- Merge #24, #36 (grokbot). Remove the chat fixture before claiming the real `/api/chat`.
- `/open/[token]` (brief `orchestrations/tasks/web-open.md`, `security-review`): uses core `consumeMagicLink`, now on `agent/pluto`, so sync first.
- `/settings/phone` (brief `orchestrations/tasks/web-phone.md`), reads `profiles.phone`, calls assistant's `/api/sms/link-code`, never writes the phone.
- Polish: sign-up link on `/login`, nav link to `/settings/phone`, loading/error states, 390px pass, `/api/grades` must not forward Postgres error text (`orchestrations/escalations/web-1.md`).
- Sync via `agent/web-sync` (PROTOCOL 2e), report `web-M1.md`, milestone PR.

### mcp (`HANDOFF-mcp.md`)
- M1 as in section 3.
- OAuth (brief `orchestrations/tasks/mcp-oauth.md`, `security-review`): protected-resource metadata, `WWW-Authenticate` with `resource_metadata`, Supabase JWT verification, `/oauth/consent` (uses web's `/login?next=`). Local round trip must run on port 3000.
- ChatGPT test after OAuth; stop after ~1 hour of trouble.
- Follow-ups: `logging.incomingRequests.ignore` for `/api/mcp/demo/` in `apps/web/next.config.ts`; log `ToolError` `db_error` causes server-side. Turn the URL-token flag off or rotate the token once OAuth works.

### assistant (`HANDOFF-assistant.md`)
Its handoff says F2 helpers aren't on `agent/pluto`; **they are now** (F2 merged as `9c82365`). So:
- Sync `agent/pluto` into `agent/assistant` via `agent/assistant-sync`. Replace the local `normalizePhone` copy in `apps/web/lib/phone-link.ts` with core's.
- `POST /api/chat` (session, NDJSON `text`/`citation`/`done`/`error`, persist `chat_sessions`/`chat_messages`). Never take `model` from the request body.
- `POST /api/agent/reply` (`x-internal-secret`), `POST /api/magic-link` (host must check the file belongs to the student), `POST /api/sms/inbound` (Sendblue webhook secret, idempotent, `LINK <code>` -> `consumeLinkCode`, unknown numbers get a fixed reply), `/sms-sim`, `POST /api/alerts/demo`, `GET /cal/[token].ics`.
- Verify `GEMINI_MODEL`: the code defaults to `gemini-4-hydrogen`, which was not checked against Google's current model list. Live Gemini and a real Sendblue text were never run.

### canvas (director-written)
State at stop: planner `canvas` was mid fresh-review of #38 when stopped. Worktrees: `C:/Pluto-canvas` (`agent/canvas`, clean, pushed), `C:/Pluto-canvas-sync-route` (`agent/canvas-sync-route`, PR #38, clean, pushed), `C:/Pluto-canvas-sync` (stale escalation checkout, ignore). Plan: `orchestrations/plans/canvas.md`; sync brief `orchestrations/tasks/canvas-sync.md`.

- **PR #38** `agent/canvas-sync-route` -> `agent/canvas` (`80149a8`, CI green, `security-review`, no fresh verdict yet). `POST /api/canvas/sync`: signed-in student or `x-internal-secret` (timing-safe; body `studentId` only on the secret path), service-role writes all filtered by that student, idempotent upserts, detects moved due dates and POSTs `/api/alerts/deadline-change` (404 recorded, not fatal). Adds migration `20261114020000_canvas_grade_group_unique.sql` (`unique (student_id, canvas_group_id)` on `grade_groups`; nulls stay allowed; I read it, it's safe).
  - **Grokbot BLOCKING:** in live mode the route uses the profile's `canvas_base_url` but falls back to the shared env `CANVAS_API_TOKEN` when the profile has no token, so the server token can be sent to a student-chosen host (and SSRF). On `agent/pluto` students can no longer write `canvas_base_url` (hardening migration), but `agent/canvas` predates it, and the fallback is wrong either way. **Fix:** use the env `CANVAS_API_TOKEN` only with the env `CANVAS_BASE_URL` (demo student only), never mix profile URL with env token; validate any base URL against the same single-label `*.instructure.com` rule the token route uses. Then fresh review (`grok-4.7-high`), post the verdict, grokbot.
  - Non-blocking: failed deadline notifications are never retried; fixture due dates are relative to the current week, so a fixtures sync in a later week reports every assignment as moved.
- **Still to build:** `POST /api/alerts/deadline-change` (`x-internal-secret`, text the new date + ICS link via core `sendSms`, `newFeedToken`, `calendarFeedUrl`); PDF download for synced files + `ingestFile`; a fixtures-mode demo trigger that moves one seeded due date; a live sync with Allen's `CANVAS_API_TOKEN` (UMass base URL, confirm `https://umamherst.instructure.com`).
- **Discard, don't merge:** `agent/canvas-token-wip` (`bc04d31`) holds leftover uncommitted files from `C:/Pluto-canvas-token`. The canvas plan says they loosen the host check (`endsWith(".instructure.com")`) compared with merged #22. Kept on a branch only so nothing was lost; delete it.
- Sync via `agent/canvas-sync` PR first (PROTOCOL 2e; `agent/canvas` lacks the hardening migration and F2), then the milestone PR.

## 5. Process rules that still apply
- Grokbot reviews and merges every PR. Merge gate: CI `check` green, plus `VERDICT: APPROVE` from a fresh reviewer on `security-review` PRs (migrations/RLS, auth, magic links, SMS webhook, service-role or internal-secret routes, Canvas token handling). GitHub can't enforce it on this private repo.
- Milestone PRs into `agent/pluto` must be merged with a **merge commit**. Grokbot squash-merged #9, so `agent/web` and `agent/canvas` share no history with `agent/pluto` past F1: always sync through a dedicated `agent/<slice>-sync` PR, taking `agent/pluto`'s version for files the slice doesn't own.
- After each milestone merge: rerun typecheck/lint/test/smoke on `agent/pluto`, open `agent/pluto` -> `main`, Allen merges to deploy.
- Only the director edits `docs/plan.md`; contract changes are logged there first.
- Migration ranges per slice are in BRIEF. Highest used: foundation `20261113000500`, canvas `20261114020000`, assistant `20261114040000`. No collisions as of wrap-up.

## 6. Environment gotchas
- **Memory:** 16 GB machine, often 0.4-2 GB free (Brave is the biggest user). One coder at a time under 2 GB; stop dev servers after checks; close coder tabs once their PR merges. Headless reviewers were killed by Claude Code's low-memory reaper; the mcp planner had better luck running reviewers as visible Cursor tabs.
- **Usage:** the Claude 5-hour meter ran out twice. The Cursor CLI is on Allen's second account: only `composer-2.5`, `auto` and Grok models work there (`grok-4.7-high` for planners/reviewers, `grok-4.7-medium`/`composer-2.5` for coders). The first Cursor account is out of Opus until 11/30.
- **Reviewers must never run a server in the foreground** (a headless run hangs until timeout). Build, start in the background on a spare port, curl, stop.
- **Shared local Supabase drift:** it has `phone_link_codes` and a hand-repaired hardening migration. Branches without assistant's migration fail `rls.test.ts` "covers every public table" locally only; CI is the judge. A `npx supabase db reset` + `npm run seed` at a quiet moment fixes it. Side containers (studio, realtime, etc.) were stopped to save memory.
- **Docker on PATH:** in bash use `export PATH="C:\\Program Files\\Docker\\Docker\\resources\\bin;$PATH"` (Windows form) before `npm run env:local`.
- **Cursor prompts** sometimes paste without submitting; send `enter` once.
- **Deleting worktrees:** workspace junctions under `node_modules/@pluto/*` need PowerShell `(Get-Item <path> -Force).Delete()` before `git worktree remove --force`.
- Real keys live in `C:/Pluto/.env.secrets` (excluded from git via `.git/info/exclude`). Never commit or print them.

## 7. Leftover worktrees and branches to clean once merged
`C:/Pluto-web-notes` (#24), `C:/Pluto-web-chat` (#36; discard its `next-env.d.ts` edit), `C:/Pluto-web-signup` (stale, don't merge again), `C:/Pluto-mcp-sync` (`agent/mcp-m1`; discard `next-env.d.ts`), `C:/Pluto-assistant-agent` (#28 merged), `C:/Pluto-assistant-phone` (orphan `node_modules` dir, not a worktree), `C:/Pluto-canvas-sync-route` (#38), `C:/Pluto-canvas-sync` (stale), `C:/Pluto-canvas-token` (now on `agent/canvas-token-wip`), `C:/Pluto-verify` (director's scratch checkout, detached). Slice worktrees: `C:/Pluto-web`, `C:/Pluto-canvas`, `C:/Pluto-mcp`, `C:/Pluto-assistant`, `C:/Pluto-pluto` (integration).
