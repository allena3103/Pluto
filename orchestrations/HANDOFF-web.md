# Web handoff

Branch `agent/web`, worktree `C:/Pluto-web`. Written Sat 2026-11-14 at wrap-up. No new work after this file. Nothing here was merged by this orchestrator.

## Open PRs (grokbot merges; do not merge them)

| PR | Branch | CI | Review | What blocks merge |
| --- | --- | --- | --- | --- |
| [#24](https://github.com/allena3103/Pluto/pull/24) web-notes | `agent/web-notes` @ `d909997` | `check` green, not a draft | No `security-review` label. None required (session-scoped reads, no service role). | Grokbot has not merged it. Diff vs `agent/web` is notes-only: `apps/web/app/(app)/notes/**` and `apps/web/components/notes/pdf-viewer.tsx` (5 files, 708 lines). |
| [#36](https://github.com/allena3103/Pluto/pull/36) web chat | `agent/web-chat` @ `a5d038c` | `check` green, not a draft | No `security-review` label. None required (client of `/api/chat` only). | Grokbot has not merged it. Diff is `apps/web/app/(app)/chat/**`, `apps/web/components/chat/**`, and `apps/web/test/ndjson-line-buffer.test.ts` (6 files, 696 lines). The real `POST /api/chat` is not on `agent/web`. The screen uses that route, and a dev-only fixture when `NEXT_PUBLIC_PLUTO_CHAT_FIXTURE=1` and `NODE_ENV` is not `production`. |

## Merged coder PRs

| PR | Result |
| --- | --- |
| [#13](https://github.com/allena3103/Pluto/pull/13) grades and deadlines | On `agent/web`. The coder merged it itself (see `orchestrations/escalations/web-1.md`). CI was green. No security review was required. Grokbot never UI-tested it on its own PR. |
| [#23](https://github.com/allena3103/Pluto/pull/23) shell, login, PWA, shadcn | Merged as `cc6feb5`. Fresh re-review on head `b94bb06` was `VERDICT: APPROVE`. CI was green. |
| [#34](https://github.com/allena3103/Pluto/pull/34) `/signup` | Merged as `a9e51a2`. Fresh review `VERDICT: APPROVE` (comment on the PR). CI was green. `"/signup"` is in `PUBLIC_PATH_PREFIXES` on current `agent/web`. |

No milestone PR into `agent/pluto` was opened. `agent/web` and `origin/agent/pluto` still diverge at the F1 squash (`87fbb9f`). Protocol 2e: sync through `agent/web-sync` before any milestone, and the milestone body must ask grokbot for a merge commit, not a squash.

## Branches and worktrees

| Path | Branch | State |
| --- | --- | --- |
| `C:/Pluto-web` | `agent/web` | Clean aside from this handoff. Pushed. |
| `C:/Pluto-web-notes` | `agent/web-notes` | Clean, matches origin, PR #24. |
| `C:/Pluto-web-chat` | `agent/web-chat` | Pushed at `a5d038c`. One uncommitted generated edit in `apps/web/next-env.d.ts` (dev import paths vs build import paths). Not product work. Do not commit it onto the PR. |
| `C:/Pluto-web-signup` | `agent/web-signup` | Clean and pushed. Stale relative to `agent/web`: its `proxy.ts` is the pre-shell file. Do not merge this branch again. The signup page on `agent/web` is the merged one. |
| `agent/web-shell` | `b94bb06` | No worktree directory. PR #23 is merged. |
| `agent/web-grades` | `49d99e9` | No worktree. PR #13 is merged. |

No web coder tabs were running at wrap-up (`web-notes`, `web-chat`, and `web-signup` were already closed). No listeners on ports 3100–3107. This orchestrator did not leave a dev server up.

## Done vs `orchestrations/files/10-web.md`

Done on `agent/web`:

1. Login with validated `next`, plus the shell nav, home, PWA, and shadcn primitives (PR #23).
6. `GET /api/grades`, `/grades` (PR #13).
7. `/deadlines`, including the struck-through moved due date (PR #13).
9. `/signup` (name, email, password, `options.data.name`, generic errors, validated `next`, link to `/login`) (PR #34). Email confirmation was already off in `config.toml`.

Waiting on grokbot, not on `agent/web` yet:

4. Notes list and PDF viewer (PR #24).
3. Chat UI against `ChatStreamEvent` (PR #36). Citations link to `/notes/<fileId>?page=<n>`. Fixture still in the branch until the real route exists.

Not started:

5. `/open/[token]`. `consumeMagicLink` is on `origin/agent/foundation` (`packages/core/src/magic-links.ts`) and is not on `agent/web` or `origin/agent/pluto`. Brief: `orchestrations/tasks/web-open.md`. Port 3105. Needs `security-review` and a fresh `grok-4.7-high` review. Do not reimplement the helper in the route.
10. `/settings/phone`. Brief: `orchestrations/tasks/web-phone.md`. Port 3107. Reads `profiles.phone`. POSTs to `/api/sms/link-code` (assistant owns that route). Must not write `profiles.phone`. Timeline row is Sat 19:00, with the assistant.
8 and Sun 01:00 polish. Loading and error states on every screen, 390px pass, remove the chat fixture, signup link from `/login`, nav link to `/settings/phone`. The login page and nav landed in #23 before those links existed, so they are a follow-up on files #23 owned.

Plan and briefs: `orchestrations/plans/web.md`, `orchestrations/tasks/web-*.md`.

## Known bugs and risks

- Local `npm test` fails one assertion in `packages/core/test/db/rls.test.ts`: the shared database has `public.phone_link_codes` and this branch has no migration for it. CI starts a fresh database and was green on #23, #34, #24, and #36. Do not `supabase db reset`. Do not edit that test to hide the drift.
- `orchestrations/escalations/web-1.md`: `/api/grades` can forward the first line of a Postgres error to the client. Fix in the polish pass: generic message, detail logged server-side only.
- Chat fixture must be deleted before a milestone that claims the real `/api/chat`.
- `agent/web-signup`'s old `proxy.ts` must not be merged back over the shell proxy. Current `agent/web` `proxy.ts` already lists `/signup` and uses `safe-next`.
- Squash ancestry vs `agent/pluto`. A plain merge will conflict. Sync PR first (PROTOCOL 2e on `origin/agent/pluto`).
- No web M1 report. `orchestrations/reports/web-M1.md` was never written.

## Next steps

1. Grokbot merges #24 and #36. Do not merge them from an agent.
2. `git pull` on `agent/web` and rerun `npm run typecheck`, `npm run lint`, and `npm test`. Expect the one local `phone_link_codes` failure until that migration is on this branch. CI is the real gate.
3. When `consumeMagicLink` is on `agent/web`, spawn `web-open` from `orchestrations/tasks/web-open.md` (one coder, `grok-4.7-medium`, then a fresh `grok-4.7-high` review).
4. Spawn `web-phone` from `orchestrations/tasks/web-phone.md` when a slot is free (`composer-2.5`).
5. After the shell links and polish, sync `origin/agent/pluto` through `agent/web-sync`, write `orchestrations/reports/web-M1.md`, and open the milestone PR into `agent/pluto` asking for a merge commit.
