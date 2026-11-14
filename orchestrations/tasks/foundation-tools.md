# Coder task: foundation-tools

Branch `agent/foundation-tools`, worktree `C:/Pluto-foundation-tools`, base and PR target `agent/foundation`. Build steps 2-3 support: the core tool functions that MCP, web chat and SMS all call. Port 3005 (not needed). Migration range `20261113110000`-`20261113115959` (only if you truly need SQL; prefer none).

## Goal
One function per MCP tool in `packages/core/src/tools/`, each `(ctx: ToolContext, input) => Promise<output>`, where input and output are parsed by the zod schemas in `packages/core/src/contract.ts`. Every surface calls these, so they are the single place where student scoping, deep links and the text cap are enforced.

## You own (edit nothing else)
- `packages/core/src/tools/**` (`list-courses.ts`, `get-recent-notes.ts`, `get-note-pages.ts`, `search-notes.ts`, `get-deadlines.ts`, `get-grades.ts`, `get-crunch-weeks.ts`, `resolve-course.ts`, `index.ts`)
- `packages/core/test/tools/**`
- `supabase/migrations/**` in your range, only if needed

Not yours: `contract.ts`, `context.ts`, `deep-links.ts`, `database.types.ts`, `packages/core/src/index.ts`, package files, the lockfile. If the contract is wrong or missing a field you need, stop and tell the orchestrator; do not edit it. No new dependencies.

## Requirements
- Names: `listCourses`, `getRecentNotes`, `getNotePages`, `searchNotes`, `getDeadlines`, `getGrades`, `getCrunchWeeks`. `tools/index.ts` exports them plus `TOOL_HANDLERS: { [K in ToolName]: (ctx, input: unknown) => Promise<ToolOutput<K>> }` keyed by the snake_case tool names, so the MCP server and the agent can dispatch by name. Each handler parses raw input with the contract input schema (applying defaults) and parses its own result with the output schema before returning.
- Read-only: `select` and the `search_notes` RPC only. No inserts, updates or deletes anywhere in `tools/`.
- Student scoping: EVERY query has an explicit `.eq('student_id', ctx.studentId)` (or passes `p_student_id: ctx.studentId` to the RPC), even though RLS is also on. `ctx.db` may be a user-session client or a service-role client; the functions must be safe with either. A file id, course id or assignment id that belongs to another student behaves exactly like one that does not exist.
- Course resolution (`resolve-course.ts`): the `course` input is a uuid or a name. Match by id, else exact case-insensitive name, else unique case-insensitive substring ("history" -> "History 105"). No match or an ambiguous match throws a typed `ToolError` (`code: 'course_not_found' | 'course_ambiguous'`, message listing the student's course names so Claude can retry). Export `ToolError`; also use it for `file_not_found` and `invalid_input`.
- `getRecentNotes`: files with `added_at` within the last `days`, `ingest_status = 'ready'`, oldest first, page text in page order. Stop adding page text once the total reaches `RECENT_NOTES_TEXT_CAP_CHARS`; set `truncated: true` and still list every file in the window with its `pageCount` and how many pages were included, so Claude can call `get_note_pages` for the rest. Never cut a page in half. Allow the cap to be overridden through an optional third argument or option for tests.
- `getNotePages`: pages of one file, optional `firstPage`/`lastPage` (1-based, inclusive), same cap behaviour with `truncated` if the contract has it; pages out of range return an empty list, not an error.
- `searchNotes`: calls the `search_notes` SQL function; optional course resolved first; maps rows to the contract shape; an empty or whitespace query returns no results.
- `getDeadlines`: assignments due between now and now + `daysAhead`, soonest first, optional course; `previousDueAt` set only when the date moved; `status` derived from `graded`/`submitted`/due date as the contract defines.
- `getGrades`: per course, per grade group: score percent = sum(score) / sum(points_possible) over graded items; `weightedGradePercent` = weighted average over groups that have graded items, renormalised by those groups' weights; null when nothing is graded. Count ungraded items. Round to 2 decimals only at the end.
- `getCrunchWeeks`: bucket upcoming assignments into Monday-start weeks for `weeksAhead` weeks (compute week boundaries in UTC and say so in a comment), score each week by number of deliverables and their weight (each assignment's share of its group weight: `group weight * points / total points in group`), rank descending, ties by earlier week.
- Every note result carries `deepLink` built with `noteUrl(ctx.appUrl, fileId, page)`. Pages are 1-based.
- Supabase errors are thrown as `ToolError` with code `db_error` (no raw SQL or other students' data in messages). Queries that can return many rows must page or set an explicit limit above the realistic maximum (Supabase caps at 1000 rows by default: `file_pages` for a 14-day window can exceed that, so page through it).

## Tests (`packages/core/test/tools/**`)
Gate with `SKIP_DB_TESTS` / `dbEnv()` from `packages/core/test/db-env.ts`. Each test file creates two throwaway users through the admin API (unique emails), inserts its own courses, grade groups, assignments, files and file_pages with the service role, and deletes the users in `afterAll` (cascade cleans up). Do not rely on seed data. Run every tool twice: with a user-session client (sign in as the throwaway user) and with a service-role client plus `studentId`.
- Isolation, per tool: student B gets nothing of student A's, including when passing A's course id / file id / course name.
- `getRecentNotes`: window boundary (file added 15 days ago excluded at default 14), page order, `truncated` false under the cap and true over it (use a small cap override and also one test with real >60k chars), no half pages, more than 1000 pages paged correctly.
- `getNotePages` ranges; `searchNotes` returns the right file and page for a distinctive word, deep link ends with `?page=<n>`.
- `getGrades` math with a hand-computed example (two groups graded, one empty). `getDeadlines` moved-date and statuses. `getCrunchWeeks` ranks the planted heavy week first.
- Pure logic (grade math, week bucketing, course matching) also has DB-free unit tests so CI covers it.

## Acceptance checks (paste real output tails in the PR body)
- `npm ci && npm run env:local -- --port 3005 && npm run typecheck && npm run lint && npm test` -> green with DB tests running.
- `PLUTO_SKIP_DB_TESTS=1 npm test` -> green.
- `grep -rnE "\.(insert|update|delete|upsert)\(" packages/core/src/tools` -> no matches.

## Process
The shared local Supabase stack is running; never stop or reset it. Commit small, `git push -u origin agent/foundation-tools` after every commit. Open a PR into `agent/foundation` with summary, contract items touched (the 7 tools), check output tails, and any contract gap you found. Reply `DONE <PR URL>`.
