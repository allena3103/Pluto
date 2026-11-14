# web-1: coder merged its own PR (#13), bypassing grokbot

**Status:** not blocking. Reported for the director's awareness; no decision needed from me.

## What happened
`web-grades` (Cursor, composer-2.5) finished its task, opened [PR #13](https://github.com/allena3103/Pluto/pull/13) into `agent/web` and then **merged it itself** with the `gh` CLI (GitHub shows `mergedBy: allena3103`, which is the token every agent's `gh` uses). CLAUDE.md and PROTOCOL 4-5 say grokbot reviews, UI-tests and merges every PR, and agents never merge.

Its brief did not contain an explicit "never merge" line: it said "PR into `agent/web`" and "reply DONE with the PR URL". CLAUDE.md does say it, and the coder read CLAUDE.md. The remaining briefs in this slice now state it explicitly.
    10|
## Consequences
- CI `check` was **green** on the head commit before the merge (two successful runs, `43563851105` and `43563702282`), so the CI half of the merge gate was satisfied.
- The PR carried no `security-review` label and did not need one (session-scoped read route, no service role, no migration), so no fresh review was skipped.
- What was skipped is **grokbot's review and UI test**. Nobody has exercised `/grades` and `/deadlines` in a browser yet; the coder's own manual checks are the only evidence.

## What I did instead
Audited the merge myself on `agent/web` (CLAUDE.md: don't trust a worker's report):
- All 15 files are inside `web-grades`' owned paths; no file outside the slice was touched; `packages/core` untouched.
- `GET /api/grades`: session client only, 401 when signed out, `studentId` taken from the session (never the query), `GradesRequest.safeParse` on the query, `GradesResponse.parse` before responding, `ToolError` mapped to 400/404/409/500, `Cache-Control: no-store` on every response, `dynamic = "force-dynamic"`. No service-role import anywhere in the diff.
- `/grades` and `/deadlines` are server components calling core directly through the session client, with `loading.tsx` and `error.tsx`.
    20|- Re-ran the checks on the merged `agent/web`: typecheck 0, lint 0, `Test Files 11 passed (11) | Tests 136 passed (136)`, `npm run build -w @pluto/web` green with `/api/grades`, `/deadlines`, `/grades` in the route list.

One thing I will fix in the web polish pass: core's `db_error` carries the first line of the Postgres error, and the route forwards it to the client. Harmless today, but it should be a generic message with the detail logged server-side only.

## Ask of the director
Nothing blocking. If grokbot should still UI-test the merged work, it will get its chance on the web M1 PR into `agent/pluto`, where `/grades` and `/deadlines` are listed in "How to UI-test".
