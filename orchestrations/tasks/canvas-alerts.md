# Coder task: canvas-alerts

Branch `agent/canvas-alerts`, worktree `C:/Pluto-canvas-alerts`, base and PR target `agent/canvas`. Build step 9 (deadline-change alert). Port 3204. Migration sub-range `20261114023000`-`20261114024959` (you should not need one; ask before adding).

You are a Cursor coder. Read `CLAUDE.md` (including "Allen's global rules"), `orchestrations/files/BRIEF.md` and `orchestrations/plans/canvas.md` first. Follow them.

**This PR is security-sensitive** (an `INTERNAL_API_SECRET` route using the service-role key). The orchestrator labels it `security-review` and runs a fresh reviewer before grokbot merges.

## Goal
`POST /api/alerts/deadline-change`: when a Canvas sync notices a due date moved, the student gets one text with the new date and a calendar link, and the alert is recorded.

## Contract (do not change it — `packages/core/src/contract.ts`)
```ts
AlertDeadlineChangeRequest = { studentId: Id, assignmentId: Id, oldDueAt: Timestamp, newDueAt: Timestamp }
AlertResponse = { alertId: Id, sent: boolean, calendarUrl: url }   // sent=false when the SMS failed; the alert row is still saved
ENDPOINTS.alertsDeadlineChange = { method: "POST", path: "/api/alerts/deadline-change", auth: "internal", ... }
INTERNAL_SECRET_HEADER = "x-internal-secret"
```
Parse the request with the contract schema and build the response to match it exactly. If something cannot be satisfied, stop and tell the canvas orchestrator; never edit the contract.

## Core helpers you must use (from F2, already on your base — read them before coding)
- `@pluto/core/sms`: `sendSms({ admin, provider?, env?, fetch? }, { studentId, to, body }) -> { ok: true, provider, id } | { ok: false, provider, error }`. It already logs the outbound row in `sms_messages` and never throws for provider failures.
- `@pluto/core/ics`: `newFeedToken()`, `calendarFeedUrl(appUrl, token)` -> `<appUrl>/cal/<token>.ics`, `getCalendarFeed(admin, token)`.
- `@pluto/core/context`: `PlutoDb` for typing clients.
Do not reimplement any of these, and do not edit `packages/core/**`.

## You own (edit nothing else)
- `apps/web/app/api/alerts/deadline-change/route.ts`
- `packages/canvas/src/deadline-alert.ts` (the logic, so it is testable without HTTP)
- `packages/canvas/test/alerts/**`

Not yours, do not touch: `packages/core/**`, every other file in `packages/canvas` (`client.ts`, `http.ts`, `fixtures.ts`, `fixtures/**`, `token-crypto.ts`, `sync.ts`, `map.ts`, `package.json`, `src/index.ts`), `apps/web/lib/**`, `apps/web/components/**`, other `apps/web/app` routes (`/api/alerts/demo` and `/cal/**` belong to the assistant slice), `supabase/**`, `scripts/**`, root configs, `package-lock.json`, `docs/plan.md`, `.env.example`. Need something outside these files: stop and reply to the canvas orchestrator.

## `sendDeadlineChangeAlert` (`packages/canvas/src/deadline-alert.ts`)
Signature roughly:
```ts
sendDeadlineChangeAlert(deps: { admin: PlutoDb; appUrl: string; now?: Date; smsDeps?: Partial<SmsDeps> },
                        input: { studentId: string; assignmentId: string; oldDueAt: string; newDueAt: string })
  -> Promise<{ alertId: string; sent: boolean; calendarUrl: string; duplicate: boolean }>
```
1. Load the assignment with `.eq("student_id", input.studentId).eq("id", input.assignmentId)` plus its course name. Not found for that student -> a typed "not found" result the route turns into 404. **Never** load it by id alone.
2. **Idempotence:** if an `alerts` row already exists for this student with `kind = 'date_change'`, the same `assignment_id`, and `created_at` within the last hour whose message describes the same new due date, return it with `duplicate: true` and send no second text. The stage demo must produce exactly one text even if the sync runs twice.
3. Insert one `alerts` row: `student_id`, `kind: 'date_change'`, `assignment_id`, `message` (the text you send), `calendar_feed_token`. Reuse the student's existing `calendar_feed_token` from any earlier alert when they have one, so their calendar subscription keeps working; otherwise `newFeedToken()`.
4. Insert one `study_blocks` row for the alert: `alert_id`, `student_id`, `course_id`, `title` = `<Course>: <Assignment>`, a 90-minute block ending at the new due time (clamped so `ends_at > starts_at`). Without this the calendar link opens an empty feed, because `getCalendarFeed` reads `study_blocks` for the alert.
5. Look up `profiles.phone` for that student (`.eq("id", studentId)`). No phone -> `sent: false` with the alert row still saved, and no throw.
6. Send one SMS with `sendSms`. Body: the course, the assignment title, the new due date written for a human in America/New_York (for example `Thu Nov 19, 11:59 PM`), the fact that it moved, and the calendar URL. Under 320 characters, one message. Set `alerts.sent_at = now` only when `ok: true`.
7. Return `{ alertId, sent, calendarUrl, duplicate }`. A provider failure is `sent: false`, never an exception.
Every read and write filters by `student_id` explicitly. Nothing in this function writes to another student's rows.

## Route (`apps/web/app/api/alerts/deadline-change/route.ts`)
- `export const runtime = "nodejs"` and a `maxDuration`.
- Auth first, before any database work: the `x-internal-secret` header must equal `INTERNAL_API_SECRET`, compared with `crypto.timingSafeEqual` over equal-length buffers (hash both sides, or length-check first, so the compare cannot throw). Missing or wrong -> 401. `INTERNAL_API_SECRET` unset -> 500, never open. There is no session path on this route.
- Only then build the service-role client with `createAdminClient()` from `@/lib/supabase/admin`.
- Validate the body with `AlertDeadlineChangeRequest` (400 on bad input). `appUrl` comes from `APP_URL`.
- 404 when the assignment is not that student's. 200 with the `AlertResponse` body otherwise, including when `sent` is false.
- No secret, phone number or provider error detail in the response body or in a log line.

## Acceptance checks (paste the real output tails in the PR body)
From `C:/Pluto-canvas-alerts` after `npm install` and `npm run env:local -- --port 3204`:
1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build -w @pluto/web` green, and `PLUTO_SKIP_DB_TESTS=1 npm test` green.
2. DB tests (`describe.skipIf(SKIP_DB_TESTS)`, throwaway users with unique emails, deleted in `afterAll`), with `SMS_PROVIDER=simulator`:
   - one call writes exactly one `alerts` row (`kind = 'date_change'`), one `study_blocks` row and one outbound `sms_messages` row whose body contains the new date and the `/cal/<token>.ics` URL;
   - `sent_at` is set, and the returned `calendarUrl` matches `calendarFeedUrl(appUrl, token)`;
   - `getCalendarFeed(admin, token)` returns exactly that student's one study block (proves the calendar link is not empty);
   - a second identical call sends no second text and writes no second alert (`duplicate: true`);
   - an `assignmentId` belonging to another student returns not-found and writes nothing for either student;
   - a student with no phone gives `sent: false` with the alert row still saved;
   - an injected failing SMS provider gives `sent: false`, `sent_at` null, and no thrown error.
3. `curl -i` on 3204 for: no header -> 401; wrong secret -> 401; valid call -> 200 with the `AlertResponse` body; malformed body -> 400. Show that no response and no server log contains the secret or the phone number.
4. The exact SMS body text you send, copied from the simulator row, so the director can judge the demo wording.

## Process
- Local Supabase is shared and running: never stop it, never `supabase db reset`.
- Commit small, `git push -u origin agent/canvas-alerts` after every commit.
- Stop the dev server as soon as a check is done; memory is very tight and other agents are running.
- Open a PR into `agent/canvas` using `.github/pull_request_template.md`, with the real check tails and a "How to UI-test (for grokbot)" section.
- CI (`check`) must be green before you reply DONE; check with `gh pr checks <pr>`. Grokbot merges, you never merge.
- Reply `DONE <PR URL>`, or `BLOCKED:` with what you need.
