# Foundation plan

Orchestrator: foundation. Branch `agent/foundation`, worktree `C:/Pluto-foundation`, port 3000, migrations `20261113000000`-`20261113235959`.
Build steps covered: 1 (schema and seed) in F1, 2 (PDF ingest and search) plus the shared core in F2.

## F0: skeleton (orchestrator, done before any coder starts)
Built by the orchestrator so coders never fight over root files or the lockfile.
- Root `package.json` (workspaces, scripts `typecheck` `lint` `test` `smoke` `env:local` `seed` `dev`), `tsconfig.base.json`, `eslint.config.mjs`, `.gitignore`, `.github/workflows/ci.yml`.
- `packages/core` package (`@pluto/core`, source-only, subpath exports `@pluto/core/<module>`), Vitest config, `test/setup.ts`, `test/db-env.ts` (DB-test gate).
- `supabase/config.toml` (project `pluto`, OAuth 2.1 server on, dynamic client registration on, consent path `/oauth/consent`), stack started with `npx supabase start`.
- `scripts/env-local.mjs`, `scripts/dev.mjs`, `scripts/lib/env.ts`, `scripts/smoke/index.ts` (runner), `.env.example`.
- All shared dev dependencies installed up front (typescript, eslint, vitest, supabase, tsx, dotenv, pg; zod and supabase-js in core).

Rules for every coder:
- `packages/core/src/index.ts`, root `package.json`, root configs and `package-lock.json` belong to the orchestrator. Only the `shell` coder (F1) and the `ingest` coder (F2) may change the lockfile, by installing deps into the workspace they own. Anyone else who needs a dependency asks the orchestrator.
- Import core modules by subpath (`@pluto/core/contract`), never through `index.ts`.
- DB tests use `describe.skipIf(SKIP_DB_TESTS)` from `packages/core/test/db-env.ts`, create their own users with unique emails, and delete them afterwards. CI sets `PLUTO_SKIP_DB_TESTS=1`; locally they must run.
- Never `supabase db reset`. Apply migrations with `npx supabase migration up` (add `--include-all` if your timestamp is older than one already applied).

## F1 tasks (parallel, all start right after F0)

| Task | CLI | Owns | Depends on | Migration range | Port |
| --- | --- | --- | --- | --- | --- |
| `foundation-db` | claude | `supabase/migrations/**`, `supabase/seed.sql`, `scripts/seed.ts`, `packages/core/src/database.types.ts`, `packages/core/test/db/**` | F0 | `20261113000000`-`20261113095959` | 3001 |
| `foundation-contract` | claude | `packages/core/src/contract.ts`, `packages/core/src/deep-links.ts`, `packages/core/src/context.ts`, `packages/core/test/contract.test.ts`, `packages/core/test/deep-links.test.ts` | F0 | none | 3002 |
| `foundation-shell` | claude | `apps/web/**` (scaffold, `lib/supabase/**`, `middleware.ts`, `app/(app)/layout.tsx` guard, placeholder home), `package-lock.json` | F0 | none | 3003 |

Acceptance checks
- `foundation-db`: `npx supabase migration up` applies cleanly; `npm run seed` runs twice in a row without error or duplicate rows; `npm test` includes an RLS test where `other@pluto.test` (and a fresh throwaway user) reads zero demo-student rows from every table and cannot download or list the demo student's storage objects, while the demo student can read their own; `search_notes` SQL function returns the right page for a query in a test.
- `foundation-contract`: zod schemas for 7 tools and 10 endpoints, field by field against `docs/plan.md`; unit tests parse a valid example and reject an invalid one for each; deep links are `/notes/<fileId>?page=<n>`, 1-based, page 0 rejected; a list of every ambiguity resolved, for the director's decision log.
- `foundation-shell`: `npm run env:local -- --port 3003 && npm run dev` serves the app; a signed-out request to `/` ends at `/login` (302/307 with `Location: /login...`); `npm run build -w @pluto/web` passes; the page renders at 390px wide without horizontal scroll.

F1 done when: `npm run typecheck && npm run lint && npm test` green on `agent/foundation` after all three merge, RLS test proves isolation, signed-out shell redirects to `/login`. Then milestone PR F1 into `agent/pluto` with `orchestrations/reports/foundation-F1.md`.

## F2 tasks (start as soon as `db` and `contract` are merged into `agent/foundation`; do not wait for the F1 PR to merge)

| Task | CLI | Owns | Depends on | Migration range | Port |
| --- | --- | --- | --- | --- | --- |
| `foundation-ingest` | claude | `scripts/gen-pdfs.ts`, `seed/pdfs/**`, `packages/core/src/ingest.ts` (+ test), `apps/web/app/api/ingest/**`, the files/ingest part of `scripts/seed.ts`, `package-lock.json` | db, contract, shell | `20261113100000`-`20261113105959` | 3004 |
| `foundation-tools` | claude | `packages/core/src/tools/**`, `packages/core/test/tools/**` | db, contract | `20261113110000`-`20261113115959` | 3005 |
| `foundation-helpers` | claude | `packages/core/src/{magic-links,sms,ics}.ts`, `packages/core/test/helpers/**` | db, contract | `20261113120000`-`20261113125959` | 3006 |
| smoke + index | orchestrator | `scripts/smoke/00-core.ts`, `packages/core/src/index.ts` re-exports | all three merged | none | 3000 |

Acceptance checks
- `foundation-ingest`: 6-10 synthetic multi-page text PDFs in `seed/pdfs/` with a distinctive fact per page; `npm run seed` uploads them to the `notes` bucket, inserts `files` rows with `added_at` spread over the last 3 weeks, and ingests them; `POST /api/ingest` rejects a missing or wrong `x-internal-secret` (401) and fills `file_pages` with 1-based pages for a valid call; re-ingest is idempotent.
- `foundation-tools`: all 7 functions `(ctx, input) -> output`, input and output parsed by `contract.ts`, every query filtered by `studentId`; tests cover cross-student isolation for each tool, `truncated` set when over the cap, weighted grade math, date-moved deadlines, crunch-week ranking; every note result carries a deep link.
- `foundation-helpers`: magic link single use, 15 minute expiry, bound to student, file and page (tests for reuse, expiry, wrong token); `sendSms` simulator writes `sms_messages`, Sendblue path has a timeout and handled errors (tested with a mocked `fetch`); ICS builder output parses as valid iCalendar; feed-token lookup returns only that student's blocks.
- Smoke: `npm run smoke` green: every tool as the demo student, a known query returns the expected file and page, `other@pluto.test` sees nothing of the demo student.

F2 done when `npm run smoke` is green on `agent/foundation`. Then milestone PR F2 into `agent/pluto` with `orchestrations/reports/foundation-F2.md`.

## Review
Every coder PR gets a fresh headless reviewer (`claude -p`, clean context, `REVIEW.md`) run from the coder's worktree. One fix round, one re-review. Security or contract items still open go to `orchestrations/escalations/foundation-<n>.md`.

## Shared design choices (to list in the F1 report for the decision log)
- Every student-owned table has `student_id uuid not null references profiles(id)`; `profiles.id = auth.users.id`.
- Storage path `notes/<student_id>/<file_id>.pdf`.
- `magic_links` stores a SHA-256 hash of the token and has no client policies (service role only).
- `search_notes(p_student_id, p_query, p_course_id, p_limit)` is `security invoker` and filters by `p_student_id`, so it is safe for both user sessions (RLS applies) and service-role callers (SMS, demo token).
- ICS source: `study_blocks` rows linked to an `alerts` row; `alerts.calendar_feed_token` is the feed token.
- `INTERNAL_API_SECRET` travels in the `x-internal-secret` header.
- Agent env is `GEMINI_API_KEY`, `GEMINI_MODEL`, `PLUTO_LLM=mock|gemini` (director contract change e30f0fb).
