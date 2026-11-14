# Coder task: open-links (Claude, opus)

Branch `agent/open-links`, worktree `C:/Pluto-open-links`, based on `agent/pluto`, PR into **`agent/pluto`**. Port 3105. No migration. Security-sensitive: labeled `security-review`, a fresh reviewer runs before merge.

Read `CLAUDE.md`, `orchestrations/files/BRIEF.md`, `orchestrations/plans/director.md`, `apps/web/AGENTS.md` (Next 16), then `orchestrations/tasks/web-open.md`. Build two things.

## 1. `GET /open/[token]`
Exactly as `orchestrations/tasks/web-open.md` says (steps 1-7, acceptance checks 1-7), with these changes:
- `consumeMagicLink` is on this branch now (`packages/core/src/magic-links.ts`). Read it first. If it does not mark the token used atomically, stop and say so; don't write your own token logic.
- Ignore the Cursor/model lines, the PR target `agent/web`, and the "wait for the orchestrator" prerequisite.
- The dev-server lines: start in the background only, stop when done.

## 2. `POST /api/magic-link`
Contract: `ENDPOINTS` entry `/api/magic-link`, `MagicLinkRequest` / response in `packages/core/src/contract.ts`. `docs/plan.md` row: called by the agent internally, takes student id, file id, page, returns a one-time URL.
- Auth: `x-internal-secret`, checked by SHA-256 of both sides then `timingSafeEqual`, before the admin client exists. Reuse the helper `apps/web/app/api/agent/reply` already uses for this check if there is one; don't write a second copy.
- 400 on a bad body. Then check that the file belongs to that student (`files` row with `id = fileId and student_id = studentId`, and `page` within `page_count` when known). No match: 404, same response for "no such file" and "someone else's file".
- `createMagicLink` from `@pluto/core/magic-links` with `appUrl` from `APP_URL`. Response parses as the contract response.
- Check `apps/web/lib/sms-magic-link.ts`: if it calls `createMagicLink` without the same ownership check, add the check there too (you own that file for this one change).

## You own
`apps/web/app/open/**`, `apps/web/app/api/magic-link/**`, `apps/web/lib/sms-magic-link.ts` (ownership check only), tests next to them or in `apps/web/test/`. Do not edit `packages/core/**`, `contract.ts`, `docs/plan.md`, `proxy.ts`, migrations, or the lockfile.

## Tests (permanent)
- `/api/magic-link`: missing or wrong secret is 401 and makes no DB call. Another student's file is 404. Valid is 200 with an `/open/` URL.
- `/open`: a token used twice signs in once. An expired token and a garbage token both go to `/login?error=link`.

## Delivery
`npm run typecheck`, `npm run lint`, `npm test`, `npm run build -w @pluto/web` once at the end (`apps/web/.env.local` exists; run `npm run env:local` if not). Commit small, push after every commit. `gh pr create --base agent/pluto --head agent/open-links --title "Magic links: /api/magic-link and /open/[token]"`. The body lists the contract items, check tails, manual check results, and "How to UI-test". Add the label: `gh pr edit <n> --add-label security-review`. Reply `DONE <PR URL>` and go idle. If anything needs a decision, describe it and go idle.
