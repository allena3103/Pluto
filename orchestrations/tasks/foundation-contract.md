# Coder task: foundation-contract

Branch `agent/foundation-contract`, worktree `C:/Pluto-foundation-contract`, base and PR target `agent/foundation`. Build step 1 support: the code contract every other slice builds against. No database, no dev server, no migrations.

## Goal
`packages/core/src/contract.ts`: zod schemas (and inferred TypeScript types) for the inputs and outputs of all 7 MCP tools and all 10 internal endpoints in `docs/plan.md`, matching it field by field. Plus the deep-link builder and the tool context type. Four other teams code against this file tonight, so favour simple, obvious shapes.

## You own (edit nothing else)
- `packages/core/src/contract.ts`
- `packages/core/src/deep-links.ts`
- `packages/core/src/context.ts`
- `packages/core/test/contract.test.ts`, `packages/core/test/deep-links.test.ts`

Not yours: `packages/core/src/index.ts` (consumers import `@pluto/core/contract` by subpath), `package.json` files, the lockfile, `docs/plan.md`. `zod` (v4) is already installed in `packages/core`. Do not add dependencies.

## Rules for the shapes
- camelCase field names. Ids are uuid strings. Timestamps are ISO 8601 strings with offset (`z.iso.datetime({ offset: true })` or equivalent); dates without time are `YYYY-MM-DD`.
- Page numbers are 1-based integers everywhere (`z.number().int().min(1)`).
- Tool names are exactly: `list_courses`, `get_recent_notes`, `get_note_pages`, `search_notes`, `get_deadlines`, `get_grades`, `get_crunch_weeks`. Export a `TOOLS` map: `{ [toolName]: { name, description, input, output } }` (descriptions are what Claude reads to pick a tool: one or two clear sentences each, saying the tool is read-only and when to use it). Export `ToolName`, and `ToolInput<N>` / `ToolOutput<N>` helper types.
- Defaults from the plan live in the input schemas: `get_recent_notes.days` default 14, `get_deadlines.daysAhead` default 30, `get_crunch_weeks.weeksAhead` default 8, `search_notes.limit` default 10 (max 50). Put sane upper bounds on every number.
- "course (name or id)" inputs are one optional/required string field `course` that the tool functions resolve by id or case-insensitive name.
- Outputs are objects (never bare arrays) so fields can be added later, e.g. `{ courses: [...] }`.
- Every note result carries `deepLink` (absolute URL to `/notes/<fileId>?page=<n>`).
- `get_recent_notes` output: `{ course, files: [{ fileId, title, weekLabel, addedAt, pageCount, deepLink, pages: [{ page, text, deepLink }] }], truncated: boolean }`, plus when truncated a way to know where to resume (e.g. per file `pagesIncluded` vs `pageCount`). Export the cap as `RECENT_NOTES_TEXT_CAP_CHARS` (60_000) and document that `get_note_pages` fetches the rest.
- `get_deadlines` items: `assignmentId, courseId, courseName, title, dueAt, previousDueAt (nullable, set when the date moved), points, weightGroup (nullable), status` with `status` one of `upcoming | submitted | graded | overdue`.
- `get_grades` output: per course `{ courseId, courseName, groups: [{ name, weightPercent, scorePercent (nullable when nothing graded), gradedCount, ungradedCount }], weightedGradePercent (nullable), ungradedCount }`. Document the formula in a comment: weighted average over groups that have graded items, renormalised by the sum of those groups' weights.
- `get_crunch_weeks` output: weeks ranked, each `{ weekStart (YYYY-MM-DD, Monday), weekEnd, deliverableCount, totalWeightPercent, score, rank, assignments: [...] }`.
- Endpoints: export an `ENDPOINTS` map keyed by a short name with `{ method, path, request, response }` for all 10: `/api/ingest`, `/api/chat`, `/api/agent/reply`, `/api/grades`, `/api/magic-link`, `/open/:token`, `/api/sms/inbound`, `/api/alerts/demo`, `/cal/:token.ics`, `/api/alerts/deadline-change`. For routes that do not return JSON (`/open/:token` redirects, `/cal/:token.ics` returns `text/calendar`, `/api/chat` streams) define the params/request schema and describe the response in a comment and a typed constant; for `/api/chat` define the stream event union (`text` delta, `citation` with `fileId`, `page`, `deepLink`, `done`, `error`).
- `/api/sms/inbound` request is the Sendblue webhook payload: at least `from_number` and `content` (snake_case here because the provider sends it; allow unknown extra keys).
- `/api/agent/reply`: in `{ studentId, text, channel: 'web' | 'sms' }`, out `{ text, deepLink? }`. `/api/magic-link`: in `{ studentId, fileId, page }`, out `{ url, expiresAt }`. `/api/ingest`: in `{ fileId }`, out `{ fileId, status, pageCount? , error? }` with `status` one of `pending | processing | ready | failed`. `/api/alerts/deadline-change`: in `{ studentId, assignmentId, oldDueAt, newDueAt }`. `/api/alerts/demo`: in `{ studentId }`. Alert responses: `{ alertId, sent: boolean, calendarUrl }`.
- Server-to-server routes authenticate with header `x-internal-secret` (`INTERNAL_API_SECRET`): export the header name as a constant.
- Shared enums as exported zod enums: channel, ingest status, file source (`canvas | manual`), alert kind (`crunch_week | date_change`), SMS direction.
- Agent env is Gemini (`GEMINI_API_KEY`, `GEMINI_MODEL`, `PLUTO_LLM=mock|gemini`); nothing in the contract should mention Anthropic.

## deep-links.ts
- `notePath(fileId, page)` -> `/notes/<fileId>?page=<n>`; throws on a page that is not an integer >= 1.
- `noteUrl(appUrl, fileId, page)` -> absolute URL, tolerant of a trailing slash on `appUrl`.
- `parseNotePath(pathOrUrl)` -> `{ fileId, page } | null` (page defaults to 1 when missing; rejects 0 and non-integers).

## context.ts
`ToolContext = { db: SupabaseClient<Database>, studentId: string, appUrl: string }` and a tiny `makeToolContext` helper. Import the `Database` type from `./database.types` with `import type` (another coder is generating the real file; if it does not exist on your branch yet, create nothing there: type `db` as `SupabaseClient` for now and leave a one-line TODO the orchestrator will resolve at merge).

## Tests
For every tool and endpoint: one valid example parses (and defaults are applied), one invalid example is rejected (page 0, bad uuid, unknown status, missing required field). Check `TOOLS` has exactly the 7 names and `ENDPOINTS` exactly the 10 paths from the plan. Deep-link tests: round trip, page 0 and 1.5 rejected, trailing slash.

## Acceptance checks (paste real output tails in the PR body)
- `npm ci && npm run typecheck && npm run lint && npm test` -> green.
- PR body lists every place the plan was ambiguous and the shape you chose (the director logs these).

## Process
Commit small, `git push -u origin agent/foundation-contract` after every commit. Open a PR into `agent/foundation` (`gh pr create --base agent/foundation`), then reply `DONE <PR URL>`. This is the most-depended-on file in the project: aim to be done within the hour. If the plan and this brief disagree, the plan wins; note it in the PR.
