# Coder task: assistant-routes (Claude, opus)

Branch `agent/assistant-routes`, worktree `C:/Pluto-assistant-routes`, based on `agent/assistant-sync` (PR #39 into `agent/pluto`, not merged yet). Port 3403. No migration.

Read `CLAUDE.md`, `orchestrations/files/BRIEF.md`, `orchestrations/plans/director.md`, and the section `### assistant-routes` plus "Shared design" in `orchestrations/plans/assistant.md`. Follow that section, with these changes (the F2 sync has landed on this branch):

- `apps/web/lib/sms-magic-link.ts`: implement it now with `createMagicLink` from `@pluto/core/magic-links` (admin client, `studentId` from the verified request, `fileId`/`page` from the first citation, `appUrl` from `APP_URL`). Do not return a stub `null` except when there is no citation. Keep it injectable so tests don't hit the DB.
- Ignore the plan's model/Cursor lines; you are a Claude coder.
- The `/web chat` UI already streams from `/api/chat` with a fixture: find the fixture switch in `apps/web` (grep for `fixture` near the chat client) and remove it so the UI calls the real route. That one edit outside your files is allowed.

## You own
`apps/web/app/api/chat/**`, `apps/web/app/api/agent/**`, `apps/web/lib/chat-handler.ts`, `apps/web/lib/agent-reply.ts`, `apps/web/lib/sms-magic-link.ts`, their tests, the `@pluto/agent` dependency line in `apps/web/package.json` + `package-lock.json` via one `npm install`, and the chat fixture removal. Do not edit `packages/core/**`, `contract.ts`, `docs/plan.md`, or migrations.

## Security points (fresh reviewer will check these)
- `x-internal-secret`: SHA-256 both sides, `timingSafeEqual`, before constructing the admin client.
- `model` is never read from the request body.
- `/api/chat` uses the user's RLS client and still filters by `student_id`; another student's `sessionId` is a 404.
- Errors streamed to the client are fixed safe strings, never Postgres or Gemini text.

## Acceptance
As in the plan section, plus: `npm run typecheck`, `npm run lint`, `npm test` clean (run `npm run env:local` first; local Supabase is up). Do not run `npm run dev` in the foreground; for a manual check build, start in the background on 3403, curl `/api/chat` signed in as `demo@pluto.test` (mock LLM), stop the server.

## Delivery
Commit small, push after every commit. Open a PR: `gh pr create --base agent/pluto --head agent/assistant-routes`, title "Assistant: /api/chat and /api/agent/reply", body with: summary, "Depends on #39 (merge that first)", contract items touched, check output tails, how to UI-test (`/chat` as demo@pluto.test, ask "what's in my History 105 notes about the printing press", expect a cited answer). Label it: `gh pr edit <n> --add-label security-review`. Reply `DONE <PR URL>` and go idle. Anything needing a decision: describe it and go idle.
