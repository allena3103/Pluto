# Coder task: foundation-helpers

Branch `agent/foundation-helpers`, worktree `C:/Pluto-foundation-helpers`, base and PR target `agent/foundation`. Shared helpers used by build steps 6, 8 and 9 (magic links, SMS, calendar). Port 3006 (not needed). Migration range `20261113120000`-`20261113125959` (only if you truly need SQL).

## Goal
Three small, well-tested modules in `packages/core/src/` that the assistant, web and canvas slices call instead of writing their own.

## You own (edit nothing else)
- `packages/core/src/magic-links.ts`, `packages/core/src/sms.ts`, `packages/core/src/ics.ts`
- `packages/core/test/helpers/**`
- `supabase/migrations/**` in your range, only if needed

Not yours: `contract.ts`, `context.ts`, `deep-links.ts`, `database.types.ts`, `packages/core/src/index.ts`, package files, the lockfile. No new dependencies (use `node:crypto` and global `fetch`). Contract problem: stop and tell the orchestrator.

## magic-links.ts
Table `magic_links` (`token_hash`, `student_id`, `file_id`, `page`, `expires_at`, `used_at`) has RLS on and no client policies, so both functions take a service-role client.
- `createMagicLink(admin, { studentId, fileId, page, appUrl, now? }) -> { url, token, expiresAt }`. Verifies the file belongs to the student (explicit `student_id` filter) and `page >= 1`, else throws. Token: 32 random bytes, base64url. Store only the SHA-256 hex hash. Expiry 15 minutes (`MAGIC_LINK_TTL_MS` exported). URL: `<appUrl>/open/<token>`.
- `consumeMagicLink(admin, token, { now? }) -> { studentId, fileId, page, redirectPath } | null`. Single use and race-safe: one atomic `update ... set used_at = now where token_hash = $1 and used_at is null and expires_at > now returning ...` (a conditional update through supabase-js with `.is('used_at', null).gt('expires_at', ...)` and `.select()`), never read-then-write. Returns null for unknown, used or expired tokens, with no difference a caller could use to tell them apart. `redirectPath` comes from `notePath(fileId, page)` in `deep-links.ts`.
- Never log the raw token.

## sms.ts
- `sendSms(deps, { studentId, to, body }) -> { ok: true, provider, id } | { ok: false, provider, error }`. Never throws for provider failures.
- Provider chosen by `SMS_PROVIDER` (`simulator` default, `sendblue`), passed in through `deps` (`{ admin, provider?, env?, fetch? }`) so tests need no globals.
- `simulator`: inserts an `outbound` row into `sms_messages` (`student_id`, `direction`, `body`, `phone`, `provider: 'simulator'`).
- `sendblue`: `POST https://api.sendblue.co/api/send-message` with headers `sb-api-key-id` / `sb-api-secret-key`, JSON `{ number, from_number, content }` (from `SENDBLUE_API_KEY_ID`, `SENDBLUE_API_SECRET`, `SENDBLUE_FROM_NUMBER`), 10 second timeout via `AbortSignal.timeout`, non-2xx and network errors returned as `{ ok: false }` with a short message (no secrets). Also logs the outbound message to `sms_messages` with `provider: 'sendblue'`. Missing Sendblue env returns `{ ok: false }` with a clear error. Check the current Sendblue API docs for the exact endpoint and field names before coding and note the doc URL in a comment.
- `recordInboundSms(admin, { studentId, from, body, provider })` inserts an `inbound` row.
- `findStudentByPhone(admin, phone) -> { studentId, name } | null`: normalises to E.164 (strip spaces, dashes, parentheses; add `+1` to bare 10-digit US numbers) and looks up `profiles.phone`. Export `normalizePhone`.

## ics.ts
- `buildIcs({ calendarName, events: [{ uid, title, start, end, description?, url? }], now? }) -> string`: valid iCalendar (RFC 5545): CRLF line endings, `VCALENDAR`/`VERSION:2.0`/`PRODID`, one `VEVENT` per event with `UID`, `DTSTAMP`, `DTSTART`/`DTEND` in UTC (`YYYYMMDDTHHMMSSZ`), text escaped (`\\`, `;`, `,`, newlines), lines folded at 75 octets.
- `getCalendarFeed(admin, feedToken) -> { studentId, alertId, events } | null`: looks up `alerts.calendar_feed_token`, then that alert's `study_blocks` filtered by the alert's `student_id` explicitly. Unknown token returns null. Export `newFeedToken()` (32 random bytes, base64url) and `calendarFeedUrl(appUrl, token)` -> `<appUrl>/cal/<token>.ics`.

## Tests (`packages/core/test/helpers/**`)
DB tests gated with `SKIP_DB_TESTS` / `dbEnv()`; throwaway users with unique emails, deleted in `afterAll`.
- Magic links: create then consume returns the right student, file and page; second consume returns null; expired (use `now` override) returns null; wrong token returns null; a file owned by another student cannot be linked; two concurrent consumes (`Promise.all`) yield exactly one success; the stored row holds a hash, not the token.
- SMS: simulator writes one `sms_messages` row; Sendblue path with an injected fake `fetch` sends the right URL, headers and body, and returns `ok: false` on 500, on a thrown network error and on timeout; missing env handled; `normalizePhone` cases; `findStudentByPhone` finds the right student and returns null for unknown numbers.
- ICS (no DB): output has CRLF endings, folds long lines, escapes commas and newlines, one VEVENT per event, UTC timestamps; `getCalendarFeed` returns only the alert owner's blocks and null for an unknown token.

## Acceptance checks (paste real output tails in the PR body)
- `npm ci && npm run env:local -- --port 3006 && npm run typecheck && npm run lint && npm test` -> green with DB tests running.
- `PLUTO_SKIP_DB_TESTS=1 npm test` -> green.

## Process
The shared local Supabase stack is running; never stop or reset it. Commit small, `git push -u origin agent/foundation-helpers` after every commit. Open a PR into `agent/foundation` with summary, contract items touched, check output tails. Reply `DONE <PR URL>`.

## Process (updated by the director; overrides anything above that disagrees)
- You are a Cursor coder. Follow `CLAUDE.md` including "Allen's global rules".
- PR body uses `.github/pull_request_template.md`. CI (`check`) runs the database tests against a real Supabase stack: it must be green before you reply DONE. Check with `gh pr checks <pr>`.
- Grokbot merges PRs. You never merge.
- Memory is tight on this machine: stop any dev server as soon as a check is done, and do not start extra watchers.
- Type Supabase clients as `PlutoDb` from `@pluto/core/context` (`SupabaseClient<Database>`).
- This PR is security-sensitive (magic links, service-role helpers): the orchestrator labels it `security-review` and runs a fresh reviewer before grokbot merges.
