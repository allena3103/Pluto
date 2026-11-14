# Coder task: canvas-sync

Branch `agent/canvas-sync`, worktree `C:/Pluto-canvas-sync`, base and PR target `agent/canvas`. Build step 10 (live Canvas sync) and the detection half of step 9. Port 3203. Migration sub-range `20261114020000`-`20261114022959`.

You are a Cursor coder. Read `CLAUDE.md` (including "Allen's global rules"), `orchestrations/files/BRIEF.md` and `orchestrations/plans/canvas.md` first. Follow them.

**This PR is security-sensitive** (a migration, a service-role route, an internal-secret route, Canvas token decryption). The orchestrator labels it `security-review` and runs a fresh reviewer before grokbot merges.

## Goal
One idempotent sync that pulls a student's Canvas courses, assignment groups, assignments, scores and PDF file metadata into Postgres, notices when a due date moves, and is callable both by the signed-in student and by a cron job. PDF bytes and ingest are a later task: you stop at the `files` row.

## What already exists (read it, do not change it)
- `@pluto/canvas/client` -> `createCanvasClient({ baseUrl, token, mode, fetch?, timeoutMs?, maxPages?, sleep? })` with `listCourses`, `listAssignmentGroups`, `listAssignments`, `listCourseFiles`, `listModuleItems`. Pagination, rate-limit backoff and timeouts are already handled. Error classes are in `@pluto/canvas/types`.
- `packages/canvas/fixtures/**` with the three seeded courses (`seed-hist-105`, `seed-bio-151`, `seed-stat-240`), their seeded group and assignment ids, and `due_at` templates that resolve to exactly the same instants as `supabase/seed.sql`. So a fixtures sync of the seeded demo student changes nothing and must report zero due-date changes.
- `@pluto/canvas/token-crypto` -> `decryptCanvasToken(payload, keyB64?)`.
- Schema in `supabase/migrations/20261113000100_schema.sql` and RLS in `20261113000200_rls.sql`. Read both.

## You own (edit nothing else)
- `packages/canvas/src/sync.ts`, `packages/canvas/src/map.ts`
- `packages/canvas/test/sync/**`
- `apps/web/app/api/canvas/sync/route.ts`
- exactly one new file `supabase/migrations/20261114020000_canvas_grade_group_unique.sql`

Not yours, do not touch: every other file in `packages/canvas` (including `client.ts`, `http.ts`, `fixtures.ts`, `fixtures/**`, `token-crypto.ts`, `package.json`, `src/index.ts`), `packages/core/**`, `apps/web/lib/**`, `apps/web/components/**`, other `apps/web/app` routes, `supabase/seed.sql`, any other migration, `scripts/**`, root configs, `package-lock.json`, `docs/plan.md`, `.env.example`. Need a dependency or a change outside your files: stop and reply to the canvas orchestrator.

## Contract items touched
`courses`, `grade_groups`, `assignments`, `files` (schema), and you produce the `AlertDeadlineChangeRequest` bodies defined in `packages/core/src/contract.ts`. Do not edit the contract. `POST /api/canvas/sync` is not one of the ten endpoints in `docs/plan.md`: document its shape in the PR body so the director can log it.

## The migration
`grade_groups` has no unique constraint on `(student_id, canvas_group_id)`, so an upsert cannot target it. Add one additive migration, and nothing else in it:
- `alter table public.grade_groups add constraint grade_groups_student_canvas_group_key unique (student_id, canvas_group_id);`
- Nulls stay allowed (Postgres unique treats them as distinct), so rows with no Canvas id are unaffected.
- Apply it with `npx supabase migration up` (add `--include-all` if a newer timestamp is already applied). **Never `supabase db reset`** — the stack is shared with four other agents.
- Check first that the shared database has no existing duplicate `(student_id, canvas_group_id)` pair, and paste that query's output in the PR body. If there is a duplicate, stop and report rather than deleting anyone's rows.

## `syncCanvas` (`packages/canvas/src/sync.ts`)
```ts
type SyncDeps = {
  db: PlutoDb;                 // service-role or the student's session client
  studentId: string;
  client: CanvasClient;
  now?: Date;
  notifyDueDateChange?: (change: DueDateChange) => Promise<void>;
};
type DueDateChange = { assignmentId: string; courseName: string; title: string; oldDueAt: string; newDueAt: string };
type SyncResult = {
  courses: { inserted: number; updated: number };
  gradeGroups: { inserted: number; updated: number };
  assignments: { inserted: number; updated: number };
  files: { inserted: number; updated: number };
  dueDateChanges: DueDateChange[];
  errors: string[];
};
```
- Order: courses, then groups, then assignments, then files (foreign keys depend on it).
- `courses`: upsert on `(student_id, canvas_course_id)`, setting `name` and `term`.
- `grade_groups`: upsert on `(student_id, canvas_group_id)` with `course_id` resolved from the course you just upserted, `name`, `weight_percent`. A Canvas `group_weight` of 0 stays 0; never invent a weight.
- `assignments`: upsert on `(student_id, canvas_assignment_id)` with `course_id`, `grade_group_id` (resolved from `canvasGroupId`, null when unknown), `title`, `due_at`, `points_possible`, `score`, `graded`, `submitted`.
- `files`: upsert on `(student_id, canvas_file_id)` with `course_id`, `title` (the Canvas display name), `week_label` (the module name from `listModuleItems` when that file appears in a module, else null), `added_at` (Canvas `created_at`, else now), `source: 'canvas'`, `storage_path = <studentId>/<fileId>.pdf` where `<fileId>` is the `files.id` uuid, `ingest_status: 'pending'` **for new rows only** — never reset a row that is already `ready`.
- Every insert and update carries `student_id` explicitly; every read filters by it. Nothing is written for a `studentId` other than the one passed in. Use `PlutoDb` from `@pluto/core/context`.
- Batch the writes (one upsert call per table, not one per row) and keep the whole sync inside a sane time budget. A failure on one table is recorded in `errors` and does not abandon the tables already written.

### Due-date change detection
- Before upserting assignments, load the student's existing assignments for those Canvas ids (one query, filtered by `student_id`).
- A change is: the saved row exists, its `due_at` is not null, the incoming `due_at` is not null, and the two instants differ. Then set `previous_due_at` to the saved `due_at`, `due_changed_at` to `now`, and append to `dueDateChanges`.
- A title change alone is not a change. A first-time due date (saved was null) is not a change. A due date disappearing (incoming null) is not a change, and must not clear `previous_due_at`.
- Re-running with the same Canvas data produces zero changes and must leave `previous_due_at` and `due_changed_at` exactly as they were. Compare instants, not strings (`2026-11-20T04:59:00Z` and `2026-11-20T04:59:00.000+00:00` are the same moment).
- `notifyDueDateChange` is called once per change, after the upsert succeeded. A throw from it goes into `errors`; it never fails the sync.

## `POST /api/canvas/sync`
- `export const runtime = "nodejs"` and a `maxDuration` long enough for a real sync.
- Auth, before any database work or any Canvas call, in this order:
  1. If `x-internal-secret` is present: compare it to `INTERNAL_API_SECRET` with `crypto.timingSafeEqual` on equal-length buffers. On a match, take `studentId` from the validated body and use the service-role client (`createAdminClient()` from `@/lib/supabase/admin`). On a mismatch, 401 — do not fall through to the session path.
  2. Otherwise use the session client and `auth.getUser()`. No user -> 401. `studentId` is **always** the session user id; a `studentId` in the body is ignored on this path (or 403 if it disagrees — say which you chose).
  3. If `INTERNAL_API_SECRET` is unset, the internal path is unavailable and the route returns 500 rather than running open.
- Credentials: read `canvas_base_url` and `canvas_token_encrypted` for that student (explicit `student_id`/`id` filter) and decrypt with `decryptCanvasToken`. In `CANVAS_MODE=fixtures` the token is not needed and must not be required. In live mode with no stored token, fall back to `process.env.CANVAS_API_TOKEN` and `process.env.CANVAS_BASE_URL` (a development convenience Allen already has in his secrets file); if neither exists, 400 with a clear message.
- The decrypted token lives in a local variable, goes into `createCanvasClient` and nowhere else: not in the response, not in a log, not in an error. Nothing in the response body comes from the token or the ciphertext.
- Notification: build `notifyDueDateChange` so it POSTs the contract's `AlertDeadlineChangeRequest` (`studentId`, `assignmentId`, `oldDueAt`, `newDueAt`) to `${APP_URL}/api/alerts/deadline-change` with the `x-internal-secret` header, `AbortSignal.timeout(10_000)`, and failures pushed into `errors`. That route is built by a later task, so a 404 today is a recorded error, not a crash.
- Response: `{ ok: true, result: SyncResult }` with a 200, or a 4xx/5xx with `{ error: string }`. Canvas rate-limit and auth failures map to a clear 502/400 with a safe message.

## Acceptance checks (paste the real output tails in the PR body)
From `C:/Pluto-canvas-sync` after `npm install` and `npm run env:local -- --port 3203`:
1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build -w @pluto/web` all green. Also `PLUTO_SKIP_DB_TESTS=1 npm test` green.
2. The duplicate-check query before the migration, and `npx supabase migration up` output.
3. DB tests (`describe.skipIf(SKIP_DB_TESTS)`, throwaway user with a unique email, deleted in `afterAll`) proving:
   - a fixtures sync of a fresh student inserts courses, groups, assignments and files, with every row carrying that student's id;
   - **running it twice leaves identical row counts in all four tables** and reports zero `dueDateChanges` on the second run (print the counts);
   - a fixtures client whose assignment fixture has one moved due date (build it by wrapping the fixtures client in the test, not by editing `fixtures/**`) produces exactly one `dueDateChanges` entry, sets `previous_due_at` to the old instant and `due_changed_at`, and calls the injected notifier exactly once;
   - a third sync with the moved date already saved reports zero changes and does not touch `previous_due_at`;
   - a title-only change is not reported; an incoming null `due_at` is not reported and does not clear `previous_due_at`;
   - a second student synced in the same test sees none of the first student's rows, and the first student's rows are unchanged.
4. A sync of the **seeded demo student** in fixtures mode reporting zero `dueDateChanges` (this is what keeps the stage demo to one alert). Show the command and the result.
5. `curl -i` on 3203 for: no auth -> 401; `x-internal-secret` wrong -> 401; a valid internal call -> 200 with the summary; a signed-in session call -> 200. Show that no response body and no server log line contains a Canvas token.

## Process
- Local Supabase is shared and running: never stop it, never `supabase db reset`.
- Commit small, `git push -u origin agent/canvas-sync` after every commit.
- Stop the dev server as soon as a check is done; memory is very tight and other agents are running.
- Open a PR into `agent/canvas` using `.github/pull_request_template.md`, with the real check tails, the migration output, and a "How to UI-test (for grokbot)" section.
- CI (`check`) must be green before you reply DONE; check with `gh pr checks <pr>`. Grokbot merges, you never merge.
- Reply `DONE <PR URL>`, or `BLOCKED:` with what you need.
