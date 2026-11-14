# Coder task: canvas-client-fixes

Branch `agent/canvas-client-fixes`, worktree `C:/Pluto-canvas-client-fixes`, base and PR target `agent/canvas`. GitHub issues #15, #16, #17, #18, and #19, one PR. Build step 10, the client half. Port 3207. Do not start a dev server. Migrations: none.

You are a Cursor coder on `grok-4.7-medium`. Read `CLAUDE.md`, `orchestrations/files/BRIEF.md`, `orchestrations/files/PROTOCOL.md`, and `orchestrations/plans/canvas.md` first.

Do not start this task until `agent/canvas` contains the merged issue #14 origin check (`canvas-origin`). If `packages/canvas/src/http.ts` does not yet refuse a foreign `Link` origin, stop and tell the canvas orchestrator. Rebase onto the latest `agent/canvas` before you edit. Keep that origin check. Do not weaken its tests.

## Goal
Close the five follow-ups from the review of PR #12, without overlapping the already-merged origin check:

- #15 https://github.com/allena3103/Pluto/issues/15 — URL-encode course ids in request paths.
- #16 https://github.com/allena3103/Pluto/issues/16 — cap `Retry-After` and backoff.
- #17 https://github.com/allena3103/Pluto/issues/17 — invalid JSON is not a network failure and is not retried.
- #18 https://github.com/allena3103/Pluto/issues/18 — a plain 403 on files and modules is handled where the warning lives.
- #19 https://github.com/allena3103/Pluto/issues/19 — a missing fixture becomes the same 404 the live client returns, not a raw `ENOENT`.

## You own (edit nothing else)
- `packages/canvas/src/client.ts`
- `packages/canvas/src/http.ts`
- `packages/canvas/src/fixtures.ts`
- `packages/canvas/src/types.ts` only if #17 needs a distinct error class. Prefer `CanvasHttpError` with a message that says the body was not valid JSON and includes the status code. Add a class only if the existing ones cannot say that.
- `packages/canvas/test/client/**`

Not yours: `token-crypto.ts`, `index.ts`, package configs, `packages/core/**`, `apps/web/**`, `supabase/**`, `docs/plan.md`, root configs, `package-lock.json`.

## Contract items touched
None. Do not edit the contract.

## What to build

### #15 Path encoding
Every Canvas course id interpolated into a path goes through `encodeURIComponent`. A value like `100/assignments?x=1` must not change the path. Do not encode the slashes that are part of the API path itself. Cover `listAssignmentGroups`, `listAssignments`, `listCourseFiles`, and `listModuleItems`.

### #16 Delay cap
`Retry-After` and the computed backoff must not stall a sync. Cap is 60 seconds (`60_000` ms). If the header or the computed wait is greater than that, do not sleep for the header value. Throw `CanvasRateLimitError` with a message that says the retry delay exceeded 60 seconds. A `Retry-After` of `1` still waits about one second (via the injected `sleep`) and then retries, as today. A `Retry-After` of `3600` throws on that attempt without calling `sleep` with `3600000` or any larger delay.

### #17 Invalid JSON
`JSON.parse` failures on a response body are not retried and are not reported as `Canvas network request failed after 4 attempts`. Throw an error that includes the HTTP status and says the body was not valid JSON. `fetch` is called once for a `200` body of `{`.

### #18 Plain 403 on files and modules
`listCourseFiles` and `listModuleItems` catch `CanvasHttpError` with status 403, but `requestPage` returns an empty array for a non-rate-limit 403 when `allowForbiddenAsEmpty` is set, so those catches never run and the files warning never logs.

A plain 403 (not a rate-limit 403) on those two methods must return `[]` and, for files, log the existing one-time `console.warn` (`Canvas files disabled for ...`). A rate-limit 403 must still retry inside the HTTP client and must not be treated as "files disabled". Add a test that a plain 403 reaches that warning (spy on `console.warn`) and returns `[]`, and that a rate-limit 403 body still retries.

### #19 Missing fixture
`loadFixtureJson` lets `readFile` throw `ENOENT` when a resolved fixture file is absent. Catch that and return a `404` response, the same shape as an unknown route (`status: 404`). The HTTP client then throws `CanvasNotFoundError`. Callers must not see a raw `ENOENT`. Test with a course id that maps to a fixture path whose file is not on disk.

## Mocks
`CANVAS_MODE=fixtures` and injected `fetch`. No network, no database, no live token.

## Acceptance checks
From the worktree, all exit 0:

- `npm test -w @pluto/canvas` — includes new tests for #15–#19 and the origin-check tests from #14 still pass.
- `npm run typecheck`
- `npm run lint`

No test output contains a Canvas token.

## Git and PR
- Commit small. Push after every commit.
- One PR into `agent/canvas`. Do not add `security-review`. Do not merge.
- Mention issues #15 #16 #17 #18 #19 in the body (`Fixes` is fine if each issue is fully closed by this PR).

PR body:

```
## Summary
- Canvas client follow-ups #15–#19: encoded course ids, capped retry delay, distinct JSON errors, reachable 403 fallback, fixture 404.

## Contract items touched
- None.

## Checks
<paste the real tails of npm test -w @pluto/canvas, npm run typecheck, and npm run lint>

## How to UI-test (for grokbot)
No UI. Unit tests cover each issue. CI (`check`) must be green before grokbot merges.
```

When the PR is open, reply DONE with the PR URL.
