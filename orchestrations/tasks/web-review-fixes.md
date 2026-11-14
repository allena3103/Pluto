# Coder task: web-review-fixes (Claude, sonnet)

Branch `agent/web-sync`, worktree `C:/Pluto-web-sync`, PR #40 (into `agent/pluto`, already open). Push to this branch; don't open a new PR. Port 3101. No migration.

Read `CLAUDE.md` and `orchestrations/files/BRIEF.md`. Then fix the review items grokbot left on PRs #24 and #36 (both branches are merged into this one). Read them yourself: `gh pr view 24 --json reviews,comments` and `gh pr view 36 --json reviews`, including inline comments (`gh api repos/allena3103/Pluto/pulls/24/comments`, same for 36).

## Fix
1. **#36 blocking:** the chat fixture emits relative `deepLink`s, but `DeepLink` in `packages/core/src/contract.ts` needs an absolute URL. Use `noteUrl(window.location.origin, id, page)` (or the core helper that builds absolute note URLs). Add a unit test in `apps/web/test/` that runs every fixture line through `parseNdjsonLine` and expects it valid.
2. #36: `retryLast` leaves the retried text in the composer after success. Clear it.
3. #36: never show raw `err.message` to the student; use the generic fallback copy.
4. #36: drop the dead `startsWith("/")` branch in `citationHref`.
5. #24: retry in the PDF viewer must fetch a fresh signed URL (the 60s one has expired by then).
6. #24: cancel or serialize overlapping pdf.js renders on the same canvas so fast next-clicks don't hit the error state.
7. #24: pinch `preventDefault()` doesn't work in React touch handlers. Attach a native non-passive listener, or drop the custom pinch if the browser zoom is fine.

## You own
`apps/web/components/chat/**`, `apps/web/components/notes/**`, `apps/web/app/(app)/notes/**`, `apps/web/app/(app)/chat/**`, `apps/web/test/**`. Nothing else.

## Rules
- Don't run `npm run dev` in the foreground or formatters on other files.
- At the end run `npm run typecheck`, `npm run lint`, and `npm test -w @pluto/web` once. `apps/web/.env.local` exists.
- Commit small, push after every commit. When done, comment on PR #40 listing each item and its fix, with check output tails. Reply `DONE` and go idle.
