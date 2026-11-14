# Task: foundation-tools-fixes

Coder task for the foundation slice. Read `CLAUDE.md`, `orchestrations/files/BRIEF.md` and `orchestrations/files/PROTOCOL.md` first.

- Worktree `C:/Pluto-foundation-tools-fixes`, branch `agent/foundation-tools-fixes`, PR into `agent/foundation`.
- Build step 2 (core tool functions). Contract items: tools `get_recent_notes`, `get_note_pages`, `get_deadlines`, `get_grades`, `get_crunch_weeks`, `list_courses`. No shape change to `packages/core/src/contract.ts`; if you think one is needed, stop and report.
- Files you own: `packages/core/src/tools/**` and `packages/core/test/tools/**`. Nothing else. No migrations.
- Speed matters more than polish. Keep the diff small.

## Fix these GitHub issues (from grokbot's review of PR #4)

**#6 `truncated` compares against stored rows, not `pageCount`.**
In `get-recent-notes.ts`, set `truncated` when `pages.length < totalPageCount` (the file's `page_count`, falling back to the stored row count when it is null), not when it is less than the stored rows. In `get-note-pages.ts`, set `truncated` when fewer pages are returned than the requested range holds, where the range is `firstPage..min(lastPage, pageCount)`.

**#7 `get_note_pages` can stall when one page is larger than the cap.**
If the first page of the requested range alone is over the cap, return that page with its text cut to the cap and `truncated: true`, so a caller paging through always makes progress. Later pages keep today's rule: a page that does not fit is left out whole. Do not change `get_recent_notes` here; it must still never cut a page.

**#8 `.limit(5000)` / `.limit(10000)` are capped at 1,000 rows by PostgREST.**
Add one helper in `shared.ts` that reads all rows of a query with `.range()` in pages of 1,000, in a stable order (the existing order plus `id`), with a hard stop (20,000 rows; throw `ToolError("db_error", ...)` past it). Use it everywhere a `.limit(5000)` or `.limit(10000)` is used in `packages/core/src/tools`. `shared.ts` already has two `.range()` loops for page text; reuse that pattern or fold them into the helper. Every query must keep its explicit `.eq("student_id", ctx.studentId)` filter.

**#5** is already fixed by commit `7d30818` (`if (truncated) break;` in `get-recent-notes.ts`). Do not redo it; add a test for it only if one is missing (a file after the cap has `pagesIncluded: 0` and `pages: []`).

## Tests
- Add or extend tests in `packages/core/test/tools` for #6, #7 and #8. For #8 a unit test of the helper against a fake query builder is enough (for example 2,500 rows come back in three range calls); do not insert thousands of rows into the shared database.
- Database tests run against the shared local Supabase stack. Never run `supabase db reset` or `supabase stop`. Run `npm run env:local -- 3005` once in your worktree if `apps/web/.env.local` is missing.
- Memory on this machine is very tight: do not start a dev server or run a web build.

## Done when
- `npm run typecheck`, `npm run lint`, `npm test` and `npm run smoke` pass in your worktree.
- PR opened into `agent/foundation` with `gh pr create --base agent/foundation`, body from `.github/pull_request_template.md`, real output tails pasted, and `Fixes #6`, `Fixes #7`, `Fixes #8` in the body. No `security-review` label. Do not merge.
- Commit small, push after every commit. When the PR is open, print its URL and stop.
