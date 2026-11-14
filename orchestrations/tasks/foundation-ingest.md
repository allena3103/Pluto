# Coder task: foundation-ingest

Branch `agent/foundation-ingest`, worktree `C:/Pluto-foundation-ingest`, base and PR target `agent/foundation`. Build step 2 (PDF ingest and search). Port 3004. Migration range `20261113100000`-`20261113105959` (only if needed).

## Goal
Synthetic lecture PDFs in the repo, an ingest function that turns a stored PDF into one `file_pages` row per page, the `POST /api/ingest` route, and a seed that uploads and ingests the PDFs so the demo student has searchable notes.

## You own (edit nothing else)
- `scripts/gen-pdfs.ts`, `seed/pdfs/**` (generated PDFs, committed), `seed/pdfs/manifest.json`
- `packages/core/src/ingest.ts`, `packages/core/test/ingest/**`
- `apps/web/app/api/ingest/**`
- In `scripts/seed.ts`: only the files/ingest part (the `seedFiles` seam the db coder left). Do not change the SQL seed logic.
- `package-lock.json` and dependency lines in `packages/core/package.json` / root `package.json` devDependencies, only to add the PDF libraries you need (say which in the PR).

Not yours: `contract.ts`, `database.types.ts`, `packages/core/src/index.ts`, `supabase/seed.sql`, other `apps/web` files. Contract problem: stop and tell the orchestrator.

## Synthetic PDFs (`npm exec tsx scripts/gen-pdfs.ts`)
- 8 PDFs: History 105 weeks 1-6 (one lecture each) plus one each for the two other seeded courses. 4-7 pages each, real selectable text (not images), a title line with course, week and lecture topic on page 1, readable lecture-note prose.
- Each page contains at least one distinctive, searchable fact that appears on no other page (a named event with a date, a defined term). Record them in `seed/pdfs/manifest.json`: per file `{ file, courseKey, title, weekLabel, addedDaysAgo, pages: [{ page, fact, query }] }` so tests and the smoke script can assert "query X returns file Y page N". Include at least one History 105 file older than 14 days and at least three inside the last 14 days (`addedDaysAgo` spread across the last 3 weeks).
- Content is original and synthetic. No real course material, no copyrighted text.
- Deterministic output (fixed metadata dates) so re-running does not dirty git. Use a pure-JS library (for example `pdf-lib`) that works on Windows and in Vercel functions.

## Ingest (`packages/core/src/ingest.ts`)
- `ingestFile(admin, fileId) -> { fileId, status, pageCount?, error? }` matching the `/api/ingest` response schema in `contract.ts`. Steps: load the `files` row; set `ingest_status = 'processing'`; download from the `notes` bucket at `storage_path`; extract text per page; replace the file's `file_pages` rows (delete then insert, or upsert on `(file_id, page_number)` and delete extras) with `student_id` copied from the file row; set `page_count` and `ingest_status = 'ready'`. On any failure set `ingest_status = 'failed'` and `ingest_error` (short message) and return `status: 'failed'`; never leave a file stuck in `processing`.
- Pages are 1-based: the first PDF page is `page_number = 1`.
- `extractPdfPages(bytes: Uint8Array) -> Promise<string[]>` exported separately (pure, unit-testable): normalised whitespace, text in reading order, an empty string for a page with no text.
- Extraction library must run in a Next.js route on Vercel (Node runtime) and on Windows: `unpdf` or `pdfjs-dist` legacy build are good choices. Guard against huge files (reject over 50 MB or 2000 pages with a clear error) and put a timeout on the storage download.
- Idempotent: ingesting twice leaves the same rows.

## Route (`apps/web/app/api/ingest/route.ts`)
- `POST` JSON `{ fileId }`, validated with the contract schema (400 on bad input).
- Auth first: header `x-internal-secret` must equal `INTERNAL_API_SECRET` using a constant-time compare; missing or wrong -> 401 before any database work; if `INTERNAL_API_SECRET` is unset the route returns 500 and never runs open. Only then create the service-role client (`apps/web/lib/supabase/admin.ts`).
- `export const runtime = 'nodejs'`, `maxDuration` set. Unknown file -> 404. Response body matches the contract.

## Seed
In `scripts/seed.ts` `seedFiles()`: for each manifest entry upsert a `files` row for the demo student (fixed uuid derived from the file name so it is stable, `source: 'manual'`, `added_at = now() - addedDaysAgo`, `storage_path = <demoStudentId>/<fileId>.pdf`), upload the PDF to the `notes` bucket (`upsert: true`), and run `ingestFile` directly (no HTTP needed). Re-running is safe and leaves no duplicates. Give `other@pluto.test` one small file of their own (reuse a PDF) so isolation checks have something to hide.

## Tests
- `extractPdfPages` on a committed synthetic PDF: page count matches the manifest and each page contains its fact (no DB, runs in CI).
- DB test (gated with `SKIP_DB_TESTS`): throwaway user, upload a PDF, `ingestFile` -> `ready`, pages 1..n present, `search_notes` RPC finds a manifest fact on the right page; re-ingest gives the same row count; a missing storage object ends in `failed` with `ingest_error` set.
- Route: with the dev server on 3004, show `curl` results for no secret (401), wrong secret (401), bad body (400), valid call (200 `ready`).

## Acceptance checks (paste real output tails in the PR body)
- `npm ci && npm run env:local -- --port 3004 && npm run seed` twice -> success both times; `files` and `file_pages` counts identical after the second run.
- `npm run typecheck && npm run lint && npm test` -> green with DB tests running; `PLUTO_SKIP_DB_TESTS=1 npm test` -> green; `npm run build -w @pluto/web` -> succeeds.
- A SQL or RPC check showing a manifest query returns the expected file title and page for the demo student.

## Process
The shared local Supabase stack is running; never stop or reset it. Commit small, `git push -u origin agent/foundation-ingest` after every commit. Open a PR into `agent/foundation` with summary, contract items touched (`/api/ingest`, `files`, `file_pages`), check output tails, and a "How to UI-test" section. Reply `DONE <PR URL>`.

## Process (updated by the director; overrides anything above that disagrees)
- You are a Cursor coder. Follow `CLAUDE.md` including "Allen's global rules".
- PR body uses `.github/pull_request_template.md`. CI (`check`) runs the database tests against a real Supabase stack: it must be green before you reply DONE. Check with `gh pr checks <pr>`.
- Grokbot merges PRs. You never merge.
- Memory is tight on this machine: stop any dev server as soon as a check is done, and do not start extra watchers.
- Type Supabase clients as `PlutoDb` from `@pluto/core/context` (`SupabaseClient<Database>`).
- This PR is security-sensitive (service-role route guarded by `INTERNAL_API_SECRET`): the orchestrator labels it `security-review` and runs a fresh reviewer before grokbot merges.

## Hardening rules (director, after grokbot's review of PR #9; these override anything above)
- A separate coder (`foundation-harden`) owns migration `20261113000500_harden_student_writes.sql`: students lose insert/update/delete on `files`, `files.storage_path` gets a check constraint equal to `<student_id>/<file_id>.pdf`, and students can update only `profiles.name`. Do not edit that migration, `apps/web/proxy.ts`, or its tests. Merge `origin/agent/foundation` when it lands.
- `files` rows are written only with the service role (seed, ingest, later Canvas sync). Never with a student session.
- `ingestFile` must build the storage path itself as `<student_id>/<file_id>.pdf` from the file row's `student_id` and `id`. Never download from the `storage_path` value stored in the row, and fail the ingest (`failed`, clear error) if the stored `storage_path` is set and differs.
- The seed sets `storage_path` to exactly `<student_id>/<file_id>.pdf`.
- Anything that writes `profiles.phone` or the Canvas fields uses the service role in a server route or script (the seed already does).
- Add a test: a `files` row whose `storage_path` points into another student's folder is never read from that folder.
