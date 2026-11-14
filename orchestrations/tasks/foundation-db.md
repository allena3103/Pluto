# Coder task: foundation-db

Branch `agent/foundation-db`, worktree `C:/Pluto-foundation-db`, base and PR target `agent/foundation`. Build step 1 (schema and seed). Port 3001 (you should not need a dev server). Migration range `20261113000000`-`20261113095959`.

## Goal
Schema with row-level security for every table in `docs/plan.md` "Data model outline", full-text search, the private `notes` storage bucket, a re-runnable seed, and a test that proves one student cannot read another's data.

## You own (edit nothing else)
- `supabase/migrations/**` (your range only)
- `supabase/seed.sql`
- `scripts/seed.ts`
- `packages/core/src/database.types.ts` (generated: `npx supabase gen types typescript --local > packages/core/src/database.types.ts`)
- `packages/core/test/db/**`

Not yours: `supabase/config.toml`, root `package.json`, `package-lock.json`, `packages/core/src/index.ts`, `.env.example`. All dependencies you need are already installed (`@supabase/supabase-js`, `pg`, `tsx`, `dotenv`, `vitest`). Need something else or a config change: stop and tell the orchestrator in your final message.

## Environment
- The shared local Supabase stack is already running (started from `C:/Pluto-foundation`, project id `pluto`). Other coders use it at the same time. NEVER run `supabase db reset` or `supabase stop`. Apply migrations with `npx supabase migration up` from your worktree. If you must change an already-applied migration while iterating, write a new additive migration instead.
- Run `npm ci` then `npm run env:local -- --port 3001` to write `apps/web/.env.local` (Supabase URL, anon key, service role key, `SUPABASE_DB_URL`, seed passwords). Tests and scripts load it (`packages/core/test/setup.ts`, `scripts/lib/env.ts`).
- If `docker` is not on PATH, prepend `C:\Program Files\Docker\Docker\resources\bin`.

## Schema (snake_case; add `created_at timestamptz default now()` everywhere; uuid primary keys with `gen_random_uuid()`)
Every table except `profiles` has `student_id uuid not null references profiles(id) on delete cascade` and an index on it.

- `profiles`: `id uuid primary key references auth.users(id) on delete cascade`, `name`, `phone text unique` (E.164, used for SMS lookup), `canvas_token_encrypted text`, `canvas_base_url text`. A trigger on `auth.users` insert creates the profile row (name from `raw_user_meta_data->>'name'`).
- `courses`: `name`, `term`, `canvas_course_id text`, unique `(student_id, canvas_course_id)`.
- `grade_groups`: `course_id`, `name`, `weight_percent numeric`, `canvas_group_id text`.
- `assignments`: `course_id`, `title`, `due_at timestamptz`, `previous_due_at timestamptz`, `due_changed_at timestamptz`, `points_possible numeric`, `grade_group_id` (nullable), `score numeric` (nullable), `graded boolean default false`, `submitted boolean default false`, `canvas_assignment_id text`, unique `(student_id, canvas_assignment_id)`.
- `files`: `course_id`, `title`, `week_label`, `added_at timestamptz default now()`, `source text check in ('canvas','manual')`, `storage_path text`, `ingest_status text check in ('pending','processing','ready','failed') default 'pending'`, `ingest_error text`, `page_count int`, `canvas_file_id text`, unique `(student_id, canvas_file_id)`.
- `file_pages`: `file_id` (cascade), `page_number int check (page_number >= 1)`, `text text`, `search tsvector generated always as (to_tsvector('english', coalesce(text,''))) stored`, GIN index on `search`, unique `(file_id, page_number)`.
- `chat_sessions`: `channel text check in ('web','sms')`, `title`.
- `chat_messages`: `session_id` (cascade), `role text check in ('user','assistant')`, `text`, `cited_file_id` (nullable, set null), `cited_page int check (cited_page >= 1)`, `channel text check in ('web','sms')`.
- `magic_links`: `token_hash text unique not null` (SHA-256 hex of the token; the raw token is never stored), `file_id`, `page int check (page >= 1)`, `expires_at timestamptz not null`, `used_at timestamptz`.
- `alerts`: `kind text check in ('crunch_week','date_change')`, `week_start date`, `assignment_id` (nullable), `message text`, `sent_at timestamptz`, `calendar_feed_token text unique`.
- `study_blocks` (ICS feed source): `alert_id` (cascade), `course_id` (nullable), `title`, `starts_at timestamptz`, `ends_at timestamptz`.
- `sms_messages` (simulator store and SMS log): `direction text check in ('inbound','outbound')`, `body text`, `phone text`, `provider text`.

Child rows must not be able to point at another student's parent: use composite foreign keys (`(student_id, course_id)` referencing `courses(student_id, id)` with a unique constraint on the parent) or an equivalent check, at least for `file_pages -> files`, `files -> courses`, `assignments -> courses`, `chat_messages -> chat_sessions`.

## RLS (enable on every table; every policy keyed on `auth.uid()`; `to authenticated` only, nothing for `anon`)
- `profiles`: select and update own row (`id = auth.uid()`).
- `courses`, `grade_groups`, `assignments`, `files`, `chat_sessions`, `chat_messages`: select, insert, update, delete own (`student_id = auth.uid()`, with `with check`).
- `file_pages`, `alerts`, `study_blocks`, `sms_messages`: select own only (writes are service role).
- `magic_links`: RLS on, no policies (service role only).

## Search
`search_notes(p_student_id uuid, p_query text, p_course_id uuid default null, p_limit int default 10)`, `language sql stable security invoker`, `set search_path = ''`. Uses `websearch_to_tsquery('english', p_query)`, filters `fp.student_id = p_student_id` explicitly (RLS also applies for user sessions), joins `files` and `courses`, orders by `ts_rank` desc, returns `file_id, file_title, course_id, course_name, week_label, page_number, snippet (ts_headline, short), rank`. Clamp `p_limit` to 1..50. Grant execute to `authenticated` and `service_role` only (revoke from `public`/`anon`).

## Storage
Private bucket `notes` (created in a migration, idempotent). Object path `<student_id>/<file_id>.pdf`. Policies on `storage.objects` for `authenticated`: select/insert/update/delete only where `bucket_id = 'notes' and (storage.foldername(name))[1] = auth.uid()::text`.

## Seed
- `supabase/seed.sql` is idempotent (fixed UUIDs, `on conflict ... do update`) and also runs on a director `db reset`. It creates the two auth users (`demo@pluto.test`, `other@pluto.test`, confirmed, email+password identities, passwords from the `.env.example` defaults), their profiles (demo phone `+15555550100`, other `+15555550101`), and for the demo student: History 105 plus two more courses (current term), grade groups with weights summing to 100 per course, assignments spread over the next 8 weeks using dates relative to `now()` with one clear crunch week (4+ items, including a heavy exam, in the same week), some past assignments with graded scores, and exactly one upcoming History 105 assignment with `previous_due_at` and `due_changed_at` set (the date-change demo). Give `other@pluto.test` one course and a couple of assignments so isolation tests have something to hide. No `files` rows: the ingest task adds PDFs later.
- Because dates are relative to `now()`, re-running the seed must refresh the demo student's seeded assignment dates (update on conflict), never duplicate.
- `scripts/seed.ts` (`npm run seed`): loads env with `scripts/lib/env.ts`, runs `supabase/seed.sql` through `pg` using `SUPABASE_DB_URL` (statement timeout set), then, via the auth admin API with the service role key, sets the two passwords from `DEMO_STUDENT_PASSWORD` / `OTHER_STUDENT_PASSWORD` and the demo phone from `DEMO_STUDENT_PHONE` when those env vars are set. Export a clear seam (for example `export async function seedFiles()` stub called at the end) where the ingest task will add PDF upload and ingest. Handle errors and exit non-zero on failure.
- Export the fixed seed ids (demo student id, other student id, course ids) from `scripts/lib/seed-ids.ts` so tests and the smoke script can import them. That file is yours too.

## Tests (`packages/core/test/db/**`, Vitest)
Use `SKIP_DB_TESTS` and `dbEnv()` from `packages/core/test/db-env.ts`. Tests must not depend on other tests' data except the seed, must create throwaway users with unique emails (`rls-<random>@pluto.test`) through the admin API, and delete them in `afterAll`.
1. RLS isolation: signed in as `other@pluto.test` (password from env) and as a fresh throwaway user, a `select` on every table returns zero rows belonging to the demo student, including when filtering by the demo student's id explicitly. Loop over the full table list so a new table without a test fails (compare against `information_schema.tables` for schema `public` using the service role or `pg`).
2. Write isolation: the other student cannot insert, update or delete rows with the demo student's `student_id` (for a throwaway row created by the service role).
3. Positive control: the demo student reads their own courses and assignments (so the zero-row results are not just a broken query).
4. Storage: service role uploads `<demoId>/rls-test-<random>.pdf` to `notes`; the other student cannot download it, cannot list it, cannot upload into the demo student's folder; the demo student can download it. Clean up.
5. `search_notes`: service role inserts a throwaway file and pages for a throwaway user; a query for a distinctive word returns the right file and `page_number`; the same call with another student's id returns nothing; a user-session call passing someone else's `p_student_id` returns nothing.
6. Anonymous (no session) reads return zero rows from every table.

## Acceptance checks (run them and paste the real output tails in the PR body)
- `npx supabase migration up` -> applies with no error.
- `npm run seed` twice -> both succeed; row counts identical after the second run.
- `npm run typecheck && npm run lint && npm test` -> green, with the DB tests actually running (not skipped).
- `PLUTO_SKIP_DB_TESTS=1 npm test` -> green with DB tests reported as skipped.

## Process
State the build step and contract items at the top of your PR. Commit small, `git push -u origin agent/foundation-db` after every commit. When done, open a PR into `agent/foundation` (`gh pr create --base agent/foundation`) with: summary, contract items touched (data model tables), check output tails, any choice you made where this brief or the plan was ambiguous. Then reply `DONE <PR URL>`. If you hit something that needs a decision, stop and say so instead of guessing on security.
