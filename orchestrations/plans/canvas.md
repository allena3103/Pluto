# Canvas plan

Orchestrator: canvas. Branch `agent/canvas`, worktree `C:/Pluto-canvas`, port 3200, migrations `20261114020000`-`20261114025959`.
Build steps covered: 9 (deadline-change half) and 10 (live Canvas sync). Task file: `orchestrations/files/20-canvas.md`.

## Status (restart 2026-11-14, Cursor grok-4.7-high)

Merged into `agent/canvas`: PR #12 (typed client), PR #21 (fixture due dates), PR #22 (token encryption, settings page, service-role profile write). C0 and tasks 1–2 are done.

Models (protocol 2b, second Cursor account): coders `grok-4.7-medium` for logic and `grok-4.7-high` for security fixes; fresh reviewers `grok-4.7-high`. `gpt-5.3-codex` and Claude 5 are not available on this account.

Next, in order:

1. **Now.** `canvas-origin` — issue #14 only. One coder, `grok-4.7-high`. PR labeled `security-review`. Fresh review with `grok-4.7-high` after the coder is idle. Brief: `orchestrations/tasks/canvas-origin.md`.
2. **After #14 merges.** `canvas-client-fixes` — issues #15–#19 in one PR, `grok-4.7-medium`, no `security-review` label. Same client files as #14, so it cannot run beside `canvas-origin`. Brief: `orchestrations/tasks/canvas-client-fixes.md`.
3. **After that PR merges.** `canvas-sync`, then `canvas-alerts` once `sendSms`, `newFeedToken`, and `calendarFeedUrl` are on `origin/agent/pluto`. They are on `agent/foundation` (PR #10) and not on the integration branch yet. `canvas-ingest-demo` waits on sync plus `ingestFile` on `origin/agent/pluto`.

Service-role rule (decision log on `origin/agent/pluto`, 2026-11-14, PR #9 hardening; confirmed in the restart): students cannot insert or update `files` rows, and students may update only `profiles.name`. They cannot write `canvas_token_encrypted` or `canvas_base_url`. Every sync write (courses, grade groups, assignments, files) and every token-column write uses the service-role client inside a server route, after the route has authenticated the caller, and every query is scoped to that one `student_id`. The session client is for `auth.getUser()` only. PR #22 already stores the token this way. Do not reopen it.

`docs/plan.md` on this branch does not yet contain that decision-log row. Do not edit `docs/plan.md`. A sync from `origin/agent/pluto` is a separate `agent/canvas-sync` PR (protocol 2e) and must not be mixed into a feature PR. The stale worktree `C:/Pluto-canvas-sync` is the old escalation commit, not that sync.

Max two coders (protocol 2c). Free RAM at this restart was about 0.7 GB, under the 2 GB spawn floor, so only the #14 coder starts. The client-fixes coder waits for the merge and for free RAM.

Contract items touched: `POST /api/alerts/deadline-change` (`AlertDeadlineChangeRequest`, `AlertResponse`), `INTERNAL_SECRET_HEADER`, and the `courses` / `grade_groups` / `assignments` / `files` tables that every tool reads. No new tools, no contract edits. `packages/core` is read-only for this slice: if something is missing there, stop and tell the director.

## Dependency on foundation
`agent/canvas` is based on F1 (schema, RLS, seed, `contract.ts`, web shell). F2 lands later through `origin/agent/pluto` and gives us three things we need:

| From F2 | Used by | Needed for |
| --- | --- | --- |
| `@pluto/core/ingest` -> `ingestFile(admin, fileId)` | `canvas-ingest-demo` | turning a synced PDF into `file_pages` |
| `@pluto/core/sms` -> `sendSms(deps, { studentId, to, body })` | `canvas-alerts` | texting the moved due date |
| `@pluto/core/ics` -> `newFeedToken`, `calendarFeedUrl`, `buildIcs` | `canvas-alerts` | the calendar link in the alert |

So the slice is ordered to put every F2-independent piece first. Nothing waits that does not have to.

## C0: package skeleton (orchestrator, before any coder)
Built by me so coders never fight over the lockfile or package files:
- `packages/canvas/package.json` (`@pluto/canvas`, private, `type: module`, subpath exports `@pluto/canvas/<module>` -> `src/<module>.ts`, scripts `typecheck` `lint` `test`), `tsconfig.json`, `vitest.config.ts`, `test/setup.ts`, `test/db-env.ts` (same `SKIP_DB_TESTS` gate as core), `src/index.ts` placeholder, one sanity test.
- `npm install` so the root lockfile knows the new workspace, committed by me.

Rules for every canvas coder:
- `packages/canvas/package.json`, `packages/canvas/tsconfig.json`, `packages/canvas/vitest.config.ts`, `packages/canvas/src/index.ts`, `package-lock.json` and every root config belong to me. Need a dependency: ask me. Prefer `node:crypto` and global `fetch`; no new runtime deps are expected in this slice.
- Import core by subpath (`@pluto/core/contract`, `@pluto/core/context`), never through `index.ts`.
- Never edit `packages/core/**`, `supabase/seed.sql`, `docs/plan.md`, `apps/web/components/**`, `apps/web/lib/**` or anything in another slice's ownership block in `BRIEF.md`.
- `/settings/canvas` must be self-contained Tailwind markup: `apps/web/components/**` is the web slice's and shadcn/ui is not installed yet.
- DB tests use `describe.skipIf(SKIP_DB_TESTS)`, create their own user with a unique email and delete it in `afterAll`. Never `supabase db reset`.
- Type Supabase clients as `PlutoDb` from `@pluto/core/context`.
- Stop the dev server as soon as a check is done (memory cap, PROTOCOL 2c).

## Tasks

| # | Task | CLI / model | Owns | Depends on | Migrations | Port | security-review |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `canvas-client` | merged PR #12, #21 | `packages/canvas/src/{types,http,client,fixtures}.ts`, `packages/canvas/fixtures/**`, `packages/canvas/test/client/**` | C0 | none | 3201 | no |
| 1b | `canvas-origin` | cursor `grok-4.7-high` | `packages/canvas/src/http.ts`, `packages/canvas/test/client/http.test.ts` | 1 merged | none | 3206 | yes (issue #14) |
| 1c | `canvas-client-fixes` | cursor `grok-4.7-medium` | `packages/canvas/src/{http,client,fixtures,types}.ts`, `packages/canvas/test/client/**` | 1b merged | none | 3207 | no (issues #15–#19) |
| 2 | `canvas-token` | merged PR #22 | `packages/canvas/src/token-crypto.ts`, `packages/canvas/test/token-crypto/**`, `apps/web/app/api/canvas/token/**`, `apps/web/app/(app)/settings/canvas/**` | C0 | none | 3202 | yes, done |
| 3 | `canvas-sync` | cursor `grok-4.7-medium` | `packages/canvas/src/{sync,map}.ts`, `packages/canvas/test/sync/**`, `apps/web/app/api/canvas/sync/**`, one migration | 1c and 2 merged | `20261114020000`-`20261114022959` | 3203 | yes |
| 4 | `canvas-alerts` | cursor `grok-4.7-medium` | `apps/web/app/api/alerts/deadline-change/**`, `packages/canvas/src/deadline-alert.ts`, `packages/canvas/test/alerts/**` | F2 helpers on `origin/agent/pluto` | `20261114023000`-`20261114024959` (only if needed) | 3204 | yes |
| 5 | `canvas-ingest-demo` | cursor `grok-4.7-medium` | `packages/canvas/src/{files-sync,demo-trigger}.ts`, `packages/canvas/test/files/**`, `packages/canvas/fixtures/demo/**`, `apps/web/app/api/canvas/demo-date-change/**` | 3 merged + F2 ingest | none | 3205 | yes |

Waves (max 2 coders, protocol 2c): **A** = 1b alone (1c shares `http.ts`). **B** = 1c alone. **C** = 3, then 4 when F2 helpers are on `origin/agent/pluto`. **D** = 5. Tasks 1 and 2 are merged.

### 1. canvas-client
Typed, Supabase-free Canvas REST client. `createCanvasClient({ baseUrl, token, mode, fetch?, now? })` with `listCourses`, `listAssignmentGroups(courseId)`, `listAssignments(courseId)` (with `include[]=submission`), `listCourseFiles(courseId)`, `listModuleItems(courseId)` for week labels.
- Pagination: follow `rel="next"` in the `Link` header until it is gone, cap total pages, concatenate.
- Rate limits: 429 and 403 whose body or `X-Rate-Limit-Remaining` header says throttled -> exponential backoff with jitter, honour `Retry-After`, at most 4 attempts, then a typed `CanvasRateLimitError`.
- Every request has `AbortSignal.timeout` (10 s default) and handled errors; 401/404 are typed errors, not throws of raw text. Empty arrays and `null` bodies are normal, not failures.
- `CANVAS_MODE=fixtures` replays synthetic JSON from `packages/canvas/fixtures/**` (no network, no real student data, paginated across two pages for at least one endpoint so the pagination path is exercised). Fixture courses line up with the seeded `canvas_course_id`s (`seed-hist-105`, `seed-bio-151`, `seed-stat-240`) so a fixtures sync updates the seeded rows instead of making new ones.
- The token never reaches a log line or an error message.
Acceptance: unit tests with an injected fake `fetch` prove pagination across 3 pages, 429-then-success with `Retry-After`, a 403 rate-limit body, timeout, 401, empty response, and that no test output or error message contains the token. `npm test -w @pluto/canvas` green with no network and no database. Met by PRs #12 and #21. Follow-ups are tasks 1b and 1c.

### 1b. canvas-origin (issue #14)
Foreign `Link` origins must not be fetched, so the bearer token cannot leave the configured Canvas origin. Details and checks: `orchestrations/tasks/canvas-origin.md`. Fresh reviewer model `grok-4.7-high`, prompt per protocol section 4, report commented on the PR. One fix round, then one re-review.

### 1c. canvas-client-fixes (issues #15–#19)
One PR after 1b is merged: encode course ids, cap retry delay at 60 seconds, distinct invalid-JSON errors, plain 403 handled in `listCourseFiles` / `listModuleItems`, missing fixtures return 404. Details: `orchestrations/tasks/canvas-client-fixes.md`. No fresh reviewer.

### 2. canvas-token
- `token-crypto.ts`: `encryptCanvasToken(plain, key?)` / `decryptCanvasToken(payload, key?)`, AES-256-GCM via `node:crypto`, key from `CANVAS_TOKEN_KEY` (base64, must decode to 32 bytes; a clear throw otherwise), random 12-byte IV per encryption, output `v1.<iv>.<tag>.<ciphertext>` base64url. A tampered payload or wrong key throws and never returns plaintext. Exported `isEncryptedCanvasToken`.
- `POST /api/canvas/token`: signed-in student only (`auth.getUser()` on the session client). Body `{ token, baseUrl }` validated (non-empty token; `baseUrl` must be `https:` and an `*.instructure.com` host). Writes `profiles.canvas_token_encrypted` and `canvas_base_url` for `id = user.id` with the service-role client, because students may update only `profiles.name`. Returns `{ connected: true, baseUrl }` and nothing else. `DELETE` clears both columns the same way. The service-role client is created only after `auth.getUser()` succeeds and is filtered with `.eq("id", user.id)`. Shipped in PR #22.
- `GET /api/canvas/token` returns `{ connected: boolean, baseUrl: string | null }` only. The ciphertext never leaves the server.
- `/settings/canvas`: server component reads connection state server-side, client form posts the token, shows connected or not, a disconnect button, and errors. Mobile first, works at 390px, plain Tailwind (no shadcn imports, no new components in `apps/web/components/**`). Never render the token or the ciphertext.
Acceptance: unit tests for round-trip, wrong key, tampered ciphertext, bad key length, and that `encryptCanvasToken` of the same input twice gives different output. With the dev server on 3202: `curl` unauthenticated POST -> 401; authenticated POST then `GET` -> `{ connected: true }`; `select canvas_token_encrypted from profiles` shows ciphertext that does not contain the token; `grep -r "<token>"` over `.next` build output and the response bodies finds nothing. Page screenshot at 390px.

### 3. canvas-sync
`syncCanvas({ db, studentId, client, now })` in `packages/canvas/src/sync.ts` plus the mapping in `map.ts`; `POST /api/canvas/sync` is a thin route around it.
- Upserts, in order: `courses` (on `student_id,canvas_course_id`), `grade_groups` (on `student_id,canvas_group_id`), `assignments` (on `student_id,canvas_assignment_id`, including `points_possible`, `grade_group_id`, `score`, `graded`, `submitted`), `files` metadata (on `student_id,canvas_file_id`, `source: 'canvas'`, `ingest_status: 'pending'`, `storage_path = <studentId>/<fileId>.pdf`, only `application/pdf`). Every write carries `student_id` explicitly; every read filters by it.
- All of those writes use the service-role client. Students cannot write `files` rows, and the same route must not use the session client for courses, grade groups, or assignments either. Create the service-role client only after auth succeeds. Scope every statement to the authenticated `student_id`. `files.storage_path` must equal `<student_id>/<file_id>.pdf`.
- **Migration needed:** `grade_groups` has no unique on `(student_id, canvas_group_id)`, so an upsert cannot target it. Add one additive migration in the sub-range creating `unique (student_id, canvas_group_id)` (nulls stay allowed) and nothing else. Read it in full before applying with `npx supabase migration up`; never `db reset`.
- Deadline-change detection: before upserting an assignment, compare the saved row's `title` and `due_at`. When `due_at` moves (and the saved `due_at` was not null), set `previous_due_at` to the old value and `due_changed_at = now`, and add the change to the returned `dueDateChanges`. A title-only change is not an alert. Re-running the sync with unchanged Canvas data must produce zero changes and must not overwrite `previous_due_at`.
- Returns a summary: counts per table (inserted/updated), `dueDateChanges: [{ assignmentId, title, oldDueAt, newDueAt }]`, and `errors: string[]` for partial failures.
- Notification seam: `syncCanvas` takes an optional `notifyDueDateChange` callback; the route's implementation POSTs `AlertDeadlineChangeRequest` to `${APP_URL}/api/alerts/deadline-change` with the `x-internal-secret` header, a 10 s timeout, failures logged and counted but never failing the sync. Tests inject a fake. Until task 4 merges, a 404 from that route is a logged error, not a crash.
- Route auth: either a signed-in student (`studentId` comes from the session, never from the body) **or** a valid `x-internal-secret` with `studentId` in the body (cron). Constant-time compare, auth checked before any database work. The service-role client is created only after that check, on both the session path and the internal path, and it is the only client that writes. Missing `INTERNAL_API_SECRET` -> 500, never open. Decrypts the student's token with `token-crypto`; `CANVAS_MODE=fixtures` ignores the token and uses fixtures. No token, no base URL and live mode -> 400 with a clear message. Reading `canvas_token_encrypted` also uses the service-role client scoped to that student. The plaintext token is never logged and never returned.
Acceptance: DB test with a throwaway student: fixtures sync twice leaves identical row counts in all four tables; a fixture variant with one moved due date yields exactly one `dueDateChanges` entry, sets `previous_due_at` and `due_changed_at`, and calls the injected notifier once; a third sync with the moved date already saved yields zero changes. Route checks with `curl` on 3203: no auth -> 401, wrong secret -> 401, session sync -> 200 summary. The Canvas token appears in no response and no log.

### 4. canvas-alerts
`POST /api/alerts/deadline-change`, contract `AlertDeadlineChangeRequest` -> `AlertResponse`.
- `x-internal-secret` only, constant-time compare, checked before any database work; service-role client after that.
- Loads the assignment with an explicit `student_id` filter (404 if it is not that student's), writes one `alerts` row (`kind: 'date_change'`, `assignment_id`, `message`, `calendar_feed_token` from core `newFeedToken()` reusing the student's existing token when they already have one), looks up the student's phone, sends the text with core `sendSms`, sets `sent_at` when it worked, and returns `{ alertId, sent, calendarUrl }` with `calendarUrl` from core `calendarFeedUrl(appUrl, token)`.
- Message text: course, assignment title, the new due date in the student's local phrasing, and the calendar link. One SMS, under 320 characters.
- `sent: false` when the provider fails; the alert row is still saved (contract). Never throws a 500 for a provider failure.
- Idempotence guard: the same `(assignmentId, oldDueAt, newDueAt)` within the last hour does not send a second text (the demo must show exactly one).
Acceptance: DB test with a throwaway student and `SMS_PROVIDER=simulator`: one call writes one `alerts` row and one outbound `sms_messages` row whose body contains the new date and the `/cal/<token>.ics` URL; a repeat call sends no second message; another student's `assignmentId` -> 404 and no rows; no secret -> 401. `curl` output for 401 and 200 on 3204.

### 5. canvas-ingest-demo
- `files-sync.ts`: for each `files` row the sync created with `ingest_status = 'pending'` and no storage object, download the PDF from Canvas (authenticated, streamed, 50 MB cap, timeout), upload it to the `notes` bucket at `<studentId>/<fileId>.pdf` with the service-role client, then call core `ingestFile(admin, fileId)`. Skip files already `ready` with the same Canvas `updated_at`, so a second sync downloads nothing. Failures mark that one file `failed` with `ingest_error` and let the rest continue.
- `demo-trigger.ts` + `POST /api/canvas/demo-date-change`: a fixtures-mode sync whose fixture moves one seeded History 105 assignment's due date, so the stage demo produces exactly one alert and one text. Auth: signed-in student whose id equals the target, or `x-internal-secret`. Never writes to another student.
Acceptance: DB test: a fixtures sync with a PDF fixture ends with `ingest_status = 'ready'` and `file_pages` rows numbered from 1; a second run adds no rows and re-downloads nothing. Demo trigger run twice: exactly one alert and one `sms_messages` row (the idempotence guard from task 4 holds). Shown with the real command output.

## Done when (from the task file)
- A fixtures-mode sync run twice is idempotent (row counts stable in `courses`, `grade_groups`, `assignments`, `files`, `file_pages`).
- A moved due date in fixtures produces exactly one `alerts` row and one `sms_messages` row.
- The Canvas token appears in no API response, no log and no client bundle (grep proof in the PR).
- Live mode against Allen's real token: **pending** until he puts one in `C:/Pluto/.env.secrets`. Reported as pending, never claimed as done.

## Review and merge
- Tasks 1b, 3, 4 and 5 get the `security-review` label and a fresh headless reviewer (`cursor-agent -p --force --trust --model grok-4.7-high`, clean context, `REVIEW.md`) run from the coder's worktree before grokbot sees the PR. Task 1b is a token leak. Tasks 3–5 use the service role or an internal secret. One fix round, one re-review; anything still blocking goes to `orchestrations/escalations/canvas-<n>.md`.
- Task 1c (issues #15–#19) and merged task 1 skip the fresh reviewer. Task 2 already merged with its review.
- Grokbot merges every PR. This orchestrator never merges. A PR is ready for grokbot only when CI `check` is green and, if labeled, the fresh review says `VERDICT: APPROVE`. After each merge I pull and rerun typecheck, lint, test (and smoke once F2 lands) on `agent/canvas` myself.
- Milestone PR into `agent/pluto` with `orchestrations/reports/canvas-C1.md` once tasks 1-5 are merged and the done-when checks pass.

## Keys Allen already provided
`npm run env:local` pulled 11 values out of `C:/Pluto/.env.secrets`, including `CANVAS_BASE_URL=https://umamherst.instructure.com` (so the host in the task file is confirmed) and a `CANVAS_API_TOKEN`. That makes live sync testable during the build, so:
- `CANVAS_API_TOKEN` is a server-only development fallback: in `CANVAS_MODE=live`, when the student has no `canvas_token_encrypted` row, the sync route may fall back to it. It is read from `process.env` inside the route only, never logged, never sent to a client, and the stored per-student token always wins.
- Live sync is still only "done" once a real sync of Allen's courses has run and been shown in the report; fixtures remain the path CI and the demo depend on.

## Open questions for the director
1. `.env.example` (foundation's file) does not document `CANVAS_API_TOKEN`, which `.env.secrets` already defines. Please add it there, or tell me to stop relying on it.
2. Live sync writes Allen's real course data into the shared local database. That is his own data on his own machine, but say so if you want it kept to a throwaway student instead of the seeded demo student.
3. Escalation `orchestrations/escalations/canvas-1.md` asked whether `/api/canvas/token` may use the service role after `auth.getUser()`. The restart instruction says yes: token storage and all sync writes use the service role. `BRIEF.md` still lists a shorter allowlist. Please add the line when you next edit it. Canvas will not edit `BRIEF.md`.
