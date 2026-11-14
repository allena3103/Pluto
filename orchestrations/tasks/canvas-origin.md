# Coder task: canvas-origin

Branch `agent/canvas-origin`, worktree `C:/Pluto-canvas-origin`, base and PR target `agent/canvas`. GitHub issue #14. Build step 10, the client half. Port 3206. You do not need a dev server; do not start one. Migrations: none. Do not add any.

You are a Cursor coder on `grok-4.7-high`. Read `CLAUDE.md` (including Allen's global rules), `orchestrations/files/BRIEF.md`, `orchestrations/files/PROTOCOL.md`, and `orchestrations/plans/canvas.md` first. Follow them.

## Goal
The Canvas HTTP client follows `Link` pagination URLs from Canvas and sends the Canvas bearer token with them. A `Link` whose origin is not the configured Canvas base URL leaks that token. Issue: https://github.com/allena3103/Pluto/issues/14

Before any request that would include the bearer token, the request URL's origin must match the configured base URL. If it does not, do not fetch it at all. Do not follow it without the `Authorization` header either. A foreign host must never see the token, and we must not call it.

## You own (edit nothing else)
- `packages/canvas/src/http.ts`
- `packages/canvas/test/client/http.test.ts` (add cases here; a new file under `packages/canvas/test/client/` is allowed only if the existing file cannot hold them)

Not yours: `packages/canvas/src/client.ts`, `fixtures.ts`, `types.ts`, `token-crypto.ts`, `index.ts`, package configs, `packages/core/**`, `apps/web/**`, `supabase/**`, `docs/plan.md`, root configs, `package-lock.json`. Use the existing `CanvasHttpError`. Need anything else: stop and tell the canvas orchestrator. Do not edit it.

## Contract items touched
None. Do not edit `packages/core/src/contract.ts` or `docs/plan.md`.

## What to build
Every URL passed to `fetch` with `Authorization: Bearer <token>` must be checked first.

- Resolve the candidate against the configured `baseUrl` (`new URL(target, baseUrl)`).
- Compare `origin` (scheme, host, and port) to `new URL(baseUrl).origin`.
- Reject a URL that has a username or password, even when the origin matches.
- On rejection, throw `CanvasHttpError` with status 400. The `message` and `requestPath` must not contain the token and must not contain the rejected URL. A fixed sentence is enough, for example `Canvas pagination link origin does not match the configured base URL.`
- Do not log the token, the `Authorization` header, or the rejected URL.
- Apply this to the first page and to every `rel="next"` link. A relative next path such as `/api/v1/courses?page=2` resolves against `baseUrl` and is allowed when that origin matches.
- `http://` versus `https://`, a different host, a different port, and a different subdomain are mismatches. Refuse them.
- Same-origin absolute next links keep working. The existing three-page test must stay green.
- Fixtures mode does not send the token today (`includeAuthHeader` is live-only). Do not weaken that. The new check still runs for any request that would send the token, which is what the unit test covers by constructing the HTTP client with `includeAuthHeader: true`.

## Mocks
No network and no database. Inject `fetch`. Do not read `CANVAS_API_TOKEN`. Do not call Canvas.

## Acceptance checks
From `C:/Pluto-canvas-origin`:

1. `npm test -w @pluto/canvas` exits 0. The existing pagination, retry, timeout, 401, and empty-body tests still pass.
2. A new test: first response is `200` with `Link: <https://evil.example/steal>; rel="next"`. `fetch` is called once. The thrown error is `CanvasHttpError`. `String(error.message)` and `String(error.requestPath)` do not contain the token `canvas-token-DO-NOT-LEAK` and do not contain `evil.example`.
3. A new test: `Link: <https://user:pass@canvas.local/api/v1/courses?page=2>; rel="next"` with base `https://canvas.local` is refused the same way, and `fetch` is called once.
4. A new test: a relative next link on the configured origin still returns the concatenated pages.
5. `npm run typecheck` and `npm run lint` exit 0 at the repo root.

## Git and PR
- Commit small. Push after every commit (`git push -u origin HEAD` the first time).
- PR base `agent/canvas`, head `agent/canvas-origin`.
- Add the label: `gh pr edit <pr> --add-label security-review`. The label already exists. This PR is a Canvas token leak.
- You do not review your own PR and you do not merge. The orchestrator runs the fresh reviewer. Grokbot merges.

PR body:

```
## Summary
- Pagination requests keep the Canvas bearer token on the configured origin (issue #14).

## Contract items touched
- None.

## Checks
<paste the real tails of npm test -w @pluto/canvas, npm run typecheck, and npm run lint>

## How to UI-test (for grokbot)
No UI. The client refuses a foreign Link origin in unit tests and never calls that host.

## Security review
Labeled security-review. Fresh review is run by the canvas orchestrator with grok-4.7-high. Do not claim APPROVE until that comment exists. CI (`check`) must be green before grokbot merges.
```

When the PR is open, reply DONE with the PR URL.
