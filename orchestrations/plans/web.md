# Web orchestrator plan

Branch `agent/web`, worktree `C:/Pluto-web`, port 3100 (coders 3101-3109), migration range `20261114010000`-`20261114015959` (web expects **no** migrations; if a task seems to need one, stop and escalate to the director).

Task file: `orchestrations/files/10-web.md` (items 9-11 are on `origin/agent/pluto` at `c6ee3a5`; they are copied into this plan). Build steps 5 (UI half), 6, 7, 11. Protocol: `orchestrations/files/PROTOCOL.md`, including 2b models, 2d Cursor planner, 2e sync PRs, and 4-6 grokbot, as updated on `origin/agent/pluto` (`80ddd57`). Contract: `docs/plan.md` + `packages/core/src/contract.ts`.

Restarted 2026-11-14 on Cursor `grok-4.7-high` after the previous session hit its Opus limit. Context below is from the files and `gh pr list`, not from the old session.

## Status

| PR | Branch | State | What we do |
| --- | --- | --- | --- |
| #13 | `agent/web-grades` | **Merged** (coder self-merged; see `orchestrations/escalations/web-1.md`) | Leave it. Grades and deadlines are on `agent/web`. The Postgres-error leak noted in web-1 waits for the polish pass. |
| #23 | `agent/web-shell` | **Open**, CI green. Director is finishing fix round 2 in `C:/Pluto-web-shell`. | **Do not touch** the branch, the worktree, the herdr tab, or the PR. |
| #24 | `agent/web-notes` | **Draft**, CI green, mergeable. | Waits for #23, then needs a notes-only diff against `agent/web` and green CI. Do not prompt that coder and do not edit the branch. |
| — | `origin/agent/foundation` | `consumeMagicLink` is here (`packages/core/src/magic-links.ts`) | Not on `agent/web` and not on `origin/agent/pluto`. |

`agent/web` and `origin/agent/pluto` diverged at the F1 squash (`87fbb9f`). Protocol 2e: a later sync is its own PR (`agent/web-sync` into `agent/web`), never mixed into a feature PR. A sync today would not unblock magic links, because those commits are not on `agent/pluto` yet. Do not edit `docs/plan.md` or `orchestrations/files/**`.

Coders: Cursor only, `composer-2.5` (UI) or `grok-4.7-medium` (logic). Fresh reviewers, when required: `grok-4.7-high`. Max **2** coders at once. Under 2 GB free RAM, spawn nobody (PROTOCOL 2c). At this restart free RAM was **0.51 GB**, with director, canvas, mcp, mcp-server, and web-shell still running, plus idle web-notes. Nobody is spawned in the plan commit; the orchestrator spawns the ready pair only after free RAM is at least 2 GB.

Feature branches come off `agent/web`, and their PRs target `agent/web`. Do not branch them off `agent/web-shell`: that PR diff would contain the whole shell and collide with #23. `components/ui`, `lib/safe-next.ts`, the login page, and the app nav are **not** on `agent/web`. Style with Tailwind, the same way grades does. Do not edit `apps/web/package.json` or the lockfile.

## Director items added 2026-11-14

9. **Sign-up** `/signup`: name, email, password via `supabase.auth.signUp` (name in `options.data.name`). Generic errors. Validated `next` passes through. Link from `/login` and back. Email confirmation is off (`supabase/config.toml` already has `enable_confirmations = false`; do not edit it).
10. **Phone linking** `/settings/phone`: calls `POST /api/sms/link-code` (assistant builds it) and shows "Text LINK \<code\> to \<SENDBLUE_FROM_NUMBER\>". Shows `profiles.phone` once set. Never writes `profiles.phone`.
11. PR #23 is the director's. PR #24 waits for #23.

The login-page link to `/signup`, and a nav link to `/settings/phone`, edit files #23 owns. They are a follow-up after #23 merges, not part of the signup or phone PRs.

## Dependency shape

```
W1 web-shell   PR #23, director, do not touch
W2 web-notes   PR #24, draft, waits for #23
W3 web-grades  PR #13, merged

Ready on agent/web (no file overlap; max 2 running):
  W4 web-chat     composer-2.5     port 3104
  W7 web-signup   grok-4.7-medium  port 3106   security-review
Queued until a slot and >= 2 GB free:
  W8 web-phone    composer-2.5     port 3107
Blocked:
  W5 web-open     grok-4.7-medium  port 3105   security-review
      until consumeMagicLink is on agent/web
Then:
  W6 polish + milestone report (orchestrator)
  W9 after #23 merges: link /login -> /signup, and a settings/phone entry in the shell nav
```

First pair when RAM allows: **W7 and W4**. W8 starts when one of them finishes. W5 starts only after the helper is on this branch.

## Milestones (one PR into `agent/pluto` each)

| Milestone | Contents | Report |
| --- | --- | --- |
| M1 | W1 + W2 + W3, once #23 and #24 have merged: login with `next`, app shell, PWA, notes list, PDF viewer at page n, `/api/grades`, `/grades`, `/deadlines` | `orchestrations/reports/web-M1.md` |
| M2 | W4 + W5 + W7 + W8 + W6: chat against the real `/api/chat`, `/open/[token]`, `/signup`, `/settings/phone`, loading/error states, 390px pass, chat fixture removed | `orchestrations/reports/web-M2.md` |

M1 waits on the director for #23 and then on a notes-only #24. Do not open either milestone PR from this restart.

## Tasks

Every brief lives at `orchestrations/tasks/web-<task>.md` on `agent/web` before the worktree is created. Every task: branch `agent/web-<task>`, worktree `C:/Pluto-web-<task>`, PR into `agent/web`, push after every commit, mobile first at 390px, Tailwind, `PLUTO_LLM=mock`. **Open the PR and stop. Never merge.**

### W1 `web-shell` — director, PR #23
Do not spawn, prompt, commit, or review. Port 3101 stays theirs.

### W2 `web-notes` — waiting, PR #24
Do not spawn or prompt. After #23 merges, the notes diff must be notes-only against the new `agent/web`, with green CI. Port 3102.

### W3 `web-grades` — merged, PR #13
On `agent/web`. No further coder.

### W4 `web-chat` — chat screen
Port 3104. Model: Cursor `composer-2.5`. No `security-review`.

Owns: `apps/web/app/(app)/chat/**`, `apps/web/components/chat/**`.

Acceptance:
- Posts `ChatRequest` to `/api/chat`, parses the NDJSON `ChatStreamEvent` stream (`text`, `citation`, `done`, `error`), renders text as it arrives and citation chips linking to `/notes/<fileId>?page=<n>`.
- Keeps the `sessionId` from `done` for the next message; `error` shows a readable message and leaves the typed text recoverable.
- Until `/api/chat` exists, a dev-only fixture (`NEXT_PUBLIC_PLUTO_CHAT_FIXTURE=1`, non-production only) drives the same code path. W6 deletes it before M2.
- Claude-style thread at 390px: input pinned to the bottom, no horizontal scroll, works with the on-screen keyboard.
- No new dependencies and no imports from `@/components/ui` (those files are not on this branch).

### W5 `web-open` — magic-link open (blocked)
Port 3105. Model: Cursor `grok-4.7-medium`. Label `security-review`. **Do not spawn** until `packages/core/src/magic-links.ts` on `agent/web` exports `consumeMagicLink`. It is on `origin/agent/foundation` only. The helper returns `{ studentId, fileId, page, redirectPath } | null` and marks the row used in one update. The route must call it, not reimplement it.

Owns: `apps/web/app/open/**`.

Acceptance (when unblocked):
- A token from core `createMagicLink` redirects (302) to `/notes/<fileId>?page=<n>` with a session for that student in a fresh browser profile.
- The second use of the same token, an expired token and a garbage token all redirect to `/login?error=link`.
- The route never signs in a student other than the token's owner; service role is used only after the token verifies.

### W7 `web-signup` — `/signup`
Port 3106. Model: Cursor `grok-4.7-medium`. Label `security-review` (authentication). Fresh reviewer `grok-4.7-high` before grokbot, per PROTOCOL 4, with the reviewer model from PROTOCOL 2b on `origin/agent/pluto`.

Owns: `apps/web/app/signup/**`. One extra line, and nothing else, in `apps/web/proxy.ts`: add `"/signup"` to `PUBLIC_PATH_PREFIXES`. Without that line the proxy sends every signed-out visitor to `/login`, so the page cannot be reached. Do not edit `apps/web/app/login/**` or `apps/web/lib/safe-next.ts`.

Acceptance:
- Signed out, `GET /signup` is 200, not a redirect to `/login`.
- Submitting name, email, and password calls `supabase.auth.signUp` with `options.data.name`, then lands on the validated `next` (or `/`) with a session. The profile row's `name` comes from the existing `handle_new_user` trigger. The page does not insert into `profiles`.
- `next=https://evil.example`, `next=//evil.example`, and `next=/\evil` fall back to `/`. A same-origin path with a query string is preserved.
- A failed signup shows a generic message and does not add an account-existence leak beyond what Supabase already returns.
- The page links to `/login`. The reverse link waits for W9.
- An already signed-in visitor is redirected to the validated `next` or `/`.
- `npm run typecheck && npm run lint && npm test` green; `npm run build -w @pluto/web` lists `/signup`.

### W8 `web-phone` — `/settings/phone`
Port 3107. Model: Cursor `composer-2.5`. No `security-review` (session read, no service role, no webhook, no write to `profiles.phone`).

Owns: `apps/web/app/(app)/settings/phone/**`, `apps/web/components/settings/phone/**`.

Acceptance:
- Signed in, the page shows `profiles.phone` for the session user (explicit `id` filter) or a clear "not linked" state. It never updates `profiles`.
- The button POSTs to `/api/sms/link-code` with the session cookie and no student id in the body. A `{ code }` JSON body is shown as `Text LINK <code> to <SENDBLUE_FROM_NUMBER>`, or "the Pluto number" when that env var is unset.
- A missing route (404) shows "Phone linking isn't available yet" and does not invent a code.
- Works at 390px, with loading and error states.
- `npm run typecheck && npm run lint && npm test` green; `npm run build -w @pluto/web` lists `/settings/phone`.

### W6 polish + milestone (orchestrator)
Loading and error states, 390px pass, remove the chat fixture, write the report, sync `origin/agent/pluto` through `agent/web-sync` if the histories still diverge, rerun all checks, open the milestone PR. Not this turn.

### W9 shell follow-ups (after #23 merges)
One small PR: on the login page, a link to `/signup` that keeps `next`; in the app nav, a link to `/settings/phone`. Only if those files are then on `agent/web`.

## Review and merge

- Grokbot reviews and merges every coder PR. Nobody else merges. Never `gh pr merge`.
- Fresh reviewer before grokbot: W7 (signup) and, later, W5 (magic links). W4 and W8 skip it.
- Reviewer command, one at a time, from the coder worktree: `cursor-agent -p --force --trust --model grok-4.7-high`, with `REVIEW.md` and `.review/diff.patch`.
- A PR is ready for grokbot only when CI `check` is green and, if labeled, the fresh review says `VERDICT: APPROVE`.
- After grokbot merges a coder PR: `git pull` here and rerun typecheck, lint, and test.

## Risks

| Risk | Handling |
| --- | --- |
| #23 still open, so shadcn and `safe-next` are absent | Tailwind only. Signup keeps its own `next` check under `app/signup/`. W9 switches the login link on after #23. |
| `/signup` is not public in `proxy.ts` | W7 adds that one prefix. The PR is `security-review`. |
| `consumeMagicLink` not on `agent/web` | W5 stays queued. Do not reimplement the helper in the route. |
| `POST /api/sms/link-code` is the assistant slice | W8 calls it and handles 404. It does not create the route and does not write `profiles.phone`. The column-level "name only" update policy is not on `agent/web` yet (foundation harden migration), so the page must not issue an update at all. |
| `/api/chat` does not exist | W4 uses the dev fixture. M2 waits until the screen has run against the real route. |
| Free RAM 0.51 GB at restart | Spawn nobody until free RAM is at least 2 GB. Do not start `next dev` in this worktree. Do not close the web-shell tab. |
| Squash ancestry vs `agent/pluto` | Sync is a separate PR. Feature PRs stay off `agent/web`. |
