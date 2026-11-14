# Coder task: canvas-sync-fix (Claude, opus)

Branch `agent/canvas-sync-route`, worktree `C:/Pluto-canvas-sync-route`, PR #38 (already open, into `agent/canvas`). Port 3203. No new migration.

Read `CLAUDE.md`, `orchestrations/files/BRIEF.md`, `orchestrations/tasks/canvas-sync.md` (the original task), and grokbot's review on PR #38 (`gh pr view 38 --json reviews,comments`), then fix the one blocking item below on this branch. Push to the same branch so PR #38 updates. Do not open a new PR.

## Blocking item (security)
In live mode `POST /api/canvas/sync` uses the profile's `canvas_base_url` but falls back to the shared env `CANVAS_API_TOKEN` when the profile has no stored token. A student can set their own `canvas_base_url`, so the server token goes to a host they choose (token leak + SSRF).

## Required behavior
- Credentials come as a pair, never mixed:
  - Profile has `canvas_token_encrypted`: use the decrypted profile token with the profile `canvas_base_url`. The base URL must pass the same rule as the token route: `https:` and host matching `^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.instructure\.com$` (one DNS label; no port, userinfo, or path tricks). Fail it -> 400-style error, no network call.
  - Profile has no token: use env `CANVAS_API_TOKEN` with env `CANVAS_BASE_URL` only, and only for the demo student (the seeded demo student id used elsewhere in the repo; find it, don't invent it). Any other student without a token -> clear error, no network call. The profile `canvas_base_url` is ignored on this path.
- Move the host regex into one shared helper in `packages/canvas/src/` (e.g. `host.ts`, exported via the package's existing export style) and use it from both `apps/web/app/api/canvas/token/route.ts` and the sync route, so the two can't drift.
- Fixtures mode unchanged.

## You own
`packages/canvas/src/sync.ts`, `packages/canvas/src/host.ts` (new), `packages/canvas/test/sync/**`, `apps/web/app/api/canvas/sync/route.ts`, `apps/web/app/api/canvas/token/route.ts` (import swap only), `packages/canvas/package.json` (exports only, if needed). Nothing else.

## Tests (add to `packages/canvas/test/sync/**` or next to the route's tests)
- profile URL `https://evil.example.com` + no profile token -> no fetch is made, env token never passed to the client.
- profile URL `https://evil.example.com` + profile token -> rejected before any fetch.
- `https://umamherst.instructure.com` + profile token -> client built with that URL and the decrypted token.
- non-demo student with no profile token -> error, no fetch.

## Rules
- Do not run `npm run dev` in the foreground. Do not run formatters over files you don't own.
- Run `npm run typecheck`, `npm run lint`, `npm test` once at the end (local Supabase is up; run `npm run env:local` first if `apps/web/.env.local` is missing).
- Commit small, push after every commit.
- When done, comment on PR #38 with: what changed, the check output tails, and the new tests. Then reply `DONE` here. Stop if anything needs a decision; describe it and go idle.
