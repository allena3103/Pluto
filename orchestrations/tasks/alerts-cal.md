# Coder task: alerts-cal (Claude, opus)

Branch `agent/alerts-cal`, worktree `C:/Pluto-alerts-cal`, based on `agent/pluto`, PR into **`agent/pluto`**. Port 3405. Migration range `20261114042000`-`20261114042959` (expect none). Security-sensitive: labeled `security-review`.

Read `CLAUDE.md`, `orchestrations/files/BRIEF.md`, `orchestrations/plans/director.md`, `apps/web/AGENTS.md` (Next 16), then build the section `### assistant-alerts (after sync)` in `orchestrations/plans/assistant.md` exactly: `POST /api/alerts/demo` and `GET /cal/[token].ics`. Ignore its Cursor/model and grokbot lines.

Then also build `POST /api/alerts/deadline-change` (canvas sends it when a due date moves; body `AlertDeadlineChangeRequest` in `packages/core/src/contract.ts`):
- `x-internal-secret` only, timing-safe, checked before the admin client exists. Reuse the existing helper the other internal routes use.
- Admin client. Every query is filtered by the body's `studentId`. Insert an `alerts` row, `kind` per the contract or schema, with a `calendar_feed_token` from `newFeedToken()`. Upsert one `study_blocks` row for the moved assignment that ends at the new due date. `sendSms` with the new date plus `calendarFeedUrl`. No phone: keep the alert row and return `sent: false`.
- Response parses as the contract's alert response.

Core helpers (`getCrunchWeeks`, `newFeedToken`, `calendarFeedUrl`, `buildIcs`, `getCalendarFeed`, `sendSms`) are on this branch. Use them; don't edit `packages/core/**`.

## You own
`apps/web/app/api/alerts/**`, `apps/web/app/cal/**`, `apps/web/lib/alerts-demo.ts`, `apps/web/lib/cal-feed.ts`, `apps/web/lib/deadline-change.ts`, their tests. `ical.js` may be added as a devDependency of `@pluto/web` with one `npm install`. Nothing else.

## Acceptance
The section's acceptance list, plus:
- deadline-change: wrong or missing secret is 401 with no DB call.
- A valid body for the demo student returns `sent` (simulator) and a `/cal/<token>.ics` URL whose feed has the moved block.
- Another student's id never touches the demo student's rows.

Permanent tests for the auth and cross-student cases.

## Delivery
`npm run typecheck`, `npm run lint`, `npm test`, `npm run build -w @pluto/web` once at the end. Never run a foreground server. Commit small, push after every commit. `gh pr create --base agent/pluto --head agent/alerts-cal --title "Alerts: crunch-week demo, deadline change, ICS feed"`, then `gh pr edit <n> --add-label security-review`. Reply `DONE <PR URL>` and go idle.
