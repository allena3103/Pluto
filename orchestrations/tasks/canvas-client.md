# Coder task: canvas-client

Branch `agent/canvas-client`, worktree `C:/Pluto-canvas-client`, base and PR target `agent/canvas`. Build step 10 (live Canvas sync), the client half. Port 3201 (you will not need a dev server). Migrations: none — do not add any.

You are a Cursor coder. Read `CLAUDE.md` (including "Allen's global rules"), `orchestrations/files/BRIEF.md` and `orchestrations/plans/canvas.md` first. Follow them.

## Goal
A typed, Supabase-free Canvas REST client in `@pluto/canvas` that handles pagination, rate limits, timeouts and empty responses, plus a `CANVAS_MODE=fixtures` replay mode with synthetic fixtures so every later task (and CI) works with no network and no real student data.

Nothing else in the slice can start syncing without this, so keep the surface small and the tests honest.

## You own (edit nothing else)
- `packages/canvas/src/types.ts` — the Canvas shapes you return and the error classes
- `packages/canvas/src/http.ts` — fetch wrapper: timeout, retry/backoff, `Link` pagination
- `packages/canvas/src/client.ts` — `createCanvasClient` and its methods
- `packages/canvas/src/fixtures.ts` — the fixtures transport
- `packages/canvas/fixtures/**` — the recorded synthetic JSON
- `packages/canvas/test/client/**` — your tests

Not yours, do not touch: `packages/canvas/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `test/setup.ts`, `test/db-env.ts`, anything under `packages/core/**`, `apps/web/**`, `supabase/**`, `scripts/**`, root configs, `package-lock.json`, `docs/plan.md`. Need a dependency or a change outside these files: stop and tell the canvas orchestrator (reply, do not edit).

## Contract items touched
None directly. Your output feeds the `courses`, `grade_groups`, `assignments` and `files` tables (see `supabase/migrations/20261113000100_schema.sql`) and the shapes in `packages/core/src/contract.ts`. Do not edit the contract; if your Canvas data cannot fill a contract field, stop and report it.

## What to build

### `createCanvasClient(options)`
```ts
type CanvasClientOptions = {
  baseUrl: string;            // e.g. https://umamherst.instructure.com
  token: string;              // ignored in fixtures mode
  mode?: "live" | "fixtures"; // default from CANVAS_MODE, else "fixtures"
  fetch?: typeof fetch;       // injected in tests
  timeoutMs?: number;         // default 10_000
  maxPages?: number;          // default 20, hard cap on pagination
  sleep?: (ms: number) => Promise<void>; // injected so backoff tests are instant
};
```
Methods (all read-only GETs, all paginated, all returning normalised arrays):
- `listCourses()` -> active courses with `{ canvasCourseId: string, name: string, term: string | null }`. Use `?enrollment_state=active&include[]=term&per_page=100`; `term` from the term's name when present, else null.
- `listAssignmentGroups(canvasCourseId)` -> `{ canvasGroupId, name, weightPercent }`. `group_weight` may be 0 or missing when the course does not weight groups: return 0 and do not invent weights.
- `listAssignments(canvasCourseId)` -> `{ canvasAssignmentId, title, dueAt: string | null, pointsPossible: number | null, canvasGroupId: string | null, score: number | null, graded: boolean, submitted: boolean }`. Use `?include[]=submission&per_page=100`. `graded` is true when the submission has a non-null `score` and a `workflow_state` of `graded`; `submitted` is true when `submitted_at` is set or `workflow_state` is `submitted`/`graded`. `dueAt` stays the ISO string Canvas gave (the sync task converts).
- `listCourseFiles(canvasCourseId)` -> PDFs only (`content-type` `application/pdf`, or a `.pdf` filename): `{ canvasFileId, title, url, updatedAt, createdAt, sizeBytes }`. `title` from `display_name`. A course with files disabled answers 401/403: return `[]` and set a flag on the result or log once — do not throw, since a missing files tab is normal.
- `listModuleItems(canvasCourseId)` -> `{ moduleName, canvasFileId }[]` for module items of type `File`, so the sync can label a file with its module name (used as the week label). Modules may be empty or forbidden: return `[]`.

Ids coming back from Canvas are numbers; return them as strings so they drop straight into the `canvas_*_id` text columns.

### `http.ts` rules
- Every request carries `Authorization: Bearer <token>` (live mode only), `Accept: application/json`, and `AbortSignal.timeout(timeoutMs)`.
- Pagination: parse the `Link` header, follow `rel="next"` until it is absent, stop at `maxPages` and throw a typed error naming the endpoint if the cap is hit. Honour the absolute URLs Canvas puts in the header rather than rebuilding them.
- Rate limits: Canvas answers 403 with a body containing `403 Forbidden (Rate Limit Exceeded)` and also uses 429. Treat both as retryable: up to 4 attempts, exponential backoff with jitter starting at ~500 ms, honour `Retry-After` (seconds or HTTP-date) when present, and look at `X-Rate-Limit-Remaining` / `X-Request-Cost` to log a warning when the bucket is nearly empty. After the last attempt throw `CanvasRateLimitError`.
- A 403 that is not a rate limit is a permissions error, not a retry.
- Retry 5xx and network/timeout errors with the same backoff. Never retry 401, 404 or a 4xx that is not 429/403-rate-limited.
- Typed errors in `types.ts`: `CanvasAuthError` (401), `CanvasNotFoundError` (404), `CanvasRateLimitError`, `CanvasTimeoutError`, `CanvasHttpError` (anything else) — each with `status`, the request path and a short safe message. **The token must never appear in an error message, a thrown value or any log line.** Redact `Authorization` if you log headers at all.
- Empty body, `null` body and `[]` are all normal: return `[]`.

### Fixtures mode
- `CANVAS_MODE=fixtures` (or `mode: "fixtures"`) serves JSON from `packages/canvas/fixtures/**` with no network at all. Build it as a fake `fetch` so the same `http.ts` path (pagination, headers) is exercised, not a separate code path.
- Layout: one file per endpoint, named after the path, e.g. `fixtures/courses.json`, `fixtures/courses/<canvasCourseId>/assignments.page1.json` + `.page2.json`, `.../assignment_groups.json`, `.../files.json`, `.../modules-items.json`. Document the naming in a short `fixtures/README.md`.
- At least one endpoint must be split across two fixture pages with a synthetic `Link` header so the pagination path is covered in fixtures mode too.
- Fixture courses use the seeded `canvas_course_id` values so a fixtures sync updates the seeded rows instead of creating new ones: `seed-hist-105` (History 105), `seed-bio-151` (Biology 151), `seed-stat-240` (Statistics 240). Assignment fixtures should reuse the seeded `canvas_assignment_id` values (`seed-101`, `seed-102`, `seed-103`, ...) and groups the seeded `canvas_group_id` values (`seed-hist-responses`, `seed-hist-essays`, `seed-hist-exams`, ...) from `supabase/seed.sql`. Read that file; do not guess.
- Include one PDF file entry per course in the files fixtures (title, a `url` pointing at a fixtures-only host, `updated_at`), so the later ingest task has something to download. Do not commit any PDF bytes here.
- Everything in `fixtures/**` is synthetic and invented. No real course material, no real student names, no tokens.

## Acceptance checks (paste the real output tails in the PR body)
From `C:/Pluto-canvas-client`:
1. `npm run typecheck`, `npm run lint`, `npm test` all green. Your tests must pass with no network and no database.
2. Unit tests with an injected fake `fetch` that prove, each as its own test:
   - three pages followed through `Link: <...>; rel="next"` and concatenated in order;
   - the `maxPages` cap throws the typed error;
   - 429 with `Retry-After: 1` then 200 succeeds, and the injected `sleep` was called with the honoured delay;
   - a 403 whose body says `Rate Limit Exceeded` is retried; a plain 403 is not;
   - a timeout (`AbortError`) is retried and finally throws `CanvasTimeoutError`;
   - 401 throws `CanvasAuthError` immediately with no retry;
   - an empty body, a `null` body and `[]` all yield `[]`;
   - no thrown error's `message`, `stack` or JSON form contains the token (assert against a distinctive fake token like `canvas-token-DO-NOT-LEAK`).
3. A fixtures-mode test: `createCanvasClient({ baseUrl, token: "unused", mode: "fixtures" })` returns the three seeded courses, their groups, their assignments (across the two-page endpoint) and at least one PDF per course.
4. Optional, nice to have: a read-only live smoke test, run by hand, not in the test suite. `CANVAS_BASE_URL` and `CANVAS_API_TOKEN` are already in `apps/web/.env.local` after `npm run env:local -- --port 3201`. Write a tiny throwaway script under `C:/Pluto-canvas-client/.scratch/` (gitignored, never committed) that calls `listCourses()` and prints course names and counts only. Paste the course count and the first course name in the PR body, nothing else — no tokens, no assignment titles. If it fails, say so and move on; this is not blocking.

## Process
- Local Supabase is shared and running: never stop it, never `supabase db reset`. You do not need it for this task.
- Commit small, `git push -u origin agent/canvas-client` after every commit.
- Memory is tight on this machine: no watchers, no dev server left running.
- Open a PR into `agent/canvas` using `.github/pull_request_template.md`: summary, build step and contract items touched, real check output tails, the merge-gate checklist, and a "How to UI-test (for grokbot)" section (for this task: there is no UI — say so and point at `npm test -w @pluto/canvas`).
- CI (`check`) must be green before you reply DONE; check with `gh pr checks <pr>`. Grokbot merges, you never merge.
- Reply `DONE <PR URL>` when the PR is open and CI is green. If you are blocked or need a file you do not own, reply with `BLOCKED:` and what you need.
