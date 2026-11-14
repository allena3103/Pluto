# Director plan (Sat 2026-11-14 12:00 EST onward)

Supersedes the slice-planner model in `PROTOCOL.md` where they conflict. Freeze Sun 03:00 EST.

## Decisions (Allen, 12:05)
1. **Flat branches.** Each slice gets one last sync + milestone PR into `agent/pluto` (the sync is done on `agent/<slice>-sync` and PR'd straight into `agent/pluto`, merge commit). After that, slice branches retire: coders branch from `agent/pluto` and PR straight into it (merge commit).
2. **No slice planners.** The director writes briefs, spawns coders, runs reviewers and checks.
3. **Claude only.** No Cursor coders or reviewers. Everything bills Allen's one Claude 5-hour meter, so model choice is the main cost lever.
4. Prod secrets generated into `C:/Pluto/.env.secrets` (`PROD_INTERNAL_API_SECRET`, `PROD_CANVAS_TOKEN_KEY`, `PROD_PLUTO_DEMO_MCP_TOKEN`, `PROD_DEMO_STUDENT_PASSWORD`, `PROD_OTHER_STUDENT_PASSWORD`; drop the `PROD_` prefix when seeding hosted; unprefixed names would override local test passwords via `env:local`).
5. Hosted DB credentials (`SUPABASE_ACCESS_TOKEN` / `HOSTED_SUPABASE_DB_URL`) not provided yet: hosted push + seed stays blocked on Allen.

## Cost rules
- Coders: `--model sonnet` by default; `--model opus` only for security-sensitive tasks (marked below).
- Fresh reviewers: `--model opus`, visible herdr tab (headless runs were killed by the memory reaper), only for `security-review` PRs, one fix round + one re-review.
- Max 2 coders at once; reviewers one at a time; close tabs as soon as a PR merges.
- Fewer, larger PRs: grokbot round trips wait on Allen. Batch grokbot requests.
- Director reads diffstat, every migration in full, and auth / secret / service-role files; runs checks with output tails only.
- `main` deploys at checkpoints only: after the mcp milestone (demo), after W2, before freeze.

## Waves
| Wave | Coder (model) | Task | Security review |
| --- | --- | --- | --- |
| W0 | director | Slice syncs + milestone PRs into `agent/pluto`: mcp (after #37, with `agent/mcp-m1`), web (after #24, #36), assistant (with core `normalizePhone`), canvas (after #38 fix). Delete `agent/canvas-token-wip`. | canvas (migration) |
| W0 | Allen | Vercel protection off, Vercel env vars, hosted DB creds, grokbot on #37/#24/#36, demo video after deploy | - |
| W1 | `canvas-sync-fix` (opus) | #38: env `CANVAS_API_TOKEN` only with env `CANVAS_BASE_URL`; validate profile base URL with the token route's single-label `*.instructure.com` rule | yes |
| W1 | `chat` (sonnet) | `POST /api/chat` NDJSON, persist sessions/messages, model never from body; remove web chat fixture | no |
| W2 | `magic-open` (opus) | `POST /api/magic-link` (file ownership check) + `/open/[token]` | yes |
| W2 | `sms` (opus) | `/api/sms/inbound`, `/api/agent/reply`, `/api/alerts/demo` | yes |
| W3 | `mcp-oauth` (opus) | brief `mcp-oauth.md`; ChatGPT test capped at 1 hour | yes |
| W3 | `ui-batch` (sonnet) | `/sms-sim`, `/settings/phone`, `/cal/[token].ics`, `/api/grades` error text | no |
| W4 | `canvas-alerts` (opus) | `/api/alerts/deadline-change`, PDF download + ingest, fixtures demo trigger, live sync | yes |
| W4 | `polish` (sonnet) | sign-up link, nav, loading/error states, 390px | no |
| 01-03 | director | final deploy, rehearsal, flip URL-token flag | - |

Cut from the bottom if short on time.
