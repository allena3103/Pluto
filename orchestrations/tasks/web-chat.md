# Coder task: web-chat (chat screen)

Branch `agent/web-chat`, worktree `C:/Pluto-web-chat`, PR into **`agent/web`**. Port **3104**. Orchestrator: web. Build step 5 (UI half). Model: Cursor `composer-2.5`.

A Claude-style chat on a phone. The agent route (`POST /api/chat`) belongs to the assistant slice: you build the client against the contract, not against their code.

## Base branch (2026-11-14 restart)
Your branch is cut from `agent/web`, which does **not** have PR #23 (login, shadcn, app nav). Do not branch from `agent/web-shell`, do not edit that PR, and do not import `@/components/ui/*` or `apps/web/lib/safe-next.ts` — those files are not on your branch. Style with Tailwind utility classes, in the same spirit as `apps/web/components/grades/`. Do not edit `apps/web/package.json` or the lockfile. Do not edit `(app)/layout.tsx`.

## Read first
- `CLAUDE.md`, `orchestrations/files/BRIEF.md`, `orchestrations/plans/web.md`.
- `apps/web/AGENTS.md`: **this is Next 16, not the Next you know.** Read the relevant guides in `node_modules/next/dist/docs/` (resolve from `apps/web`) first.
    10|- `packages/core/src/contract.ts`: `ChatRequest`, `ChatStreamEvent`, `CHAT_STREAM_CONTENT_TYPE` (`application/x-ndjson`), `ENDPOINTS.chat`, and `deep-links.ts` (`notePath`). **Never edit `packages/core/**` or `docs/plan.md`.**
- The `(app)` layout on this branch is the foundation placeholder (a header and a padded main). Your page renders inside it. Grades (`apps/web/app/(app)/grades/`) is the visual reference. Do not restyle shared files.

The stream contract, exactly: `POST /api/chat` with `{ sessionId?, message }` returns newline-delimited JSON, **one `ChatStreamEvent` per line**, ending with exactly one `done` or one `error`:
- `{ type: "text", delta }` — append in order.
- `{ type: "citation", fileId, page, deepLink }` — a cited notes page.
- `{ type: "done", sessionId }` — complete; keep `sessionId` for the next message.
- `{ type: "error", message }` — safe to show to the student.

## Setup
    20|```
npm install
npm run env:local -- --port 3104
npm run dev -w @pluto/web
```
Shared local Supabase is already running and seeded. **Never `supabase db reset`, never `supabase start/stop`.** No migrations. Mocks: `PLUTO_LLM=mock`. Login `demo@pluto.test` (password `DEMO_STUDENT_PASSWORD` in `.env.example`). Stop the dev server when you are not using it (~2 GB free memory).

## Files you own (touch nothing else)
- `apps/web/app/(app)/chat/**`
- `apps/web/components/chat/**`

    30|**You must not create `apps/web/app/api/chat/**`** — that route is the assistant slice's. Do not edit `apps/web/package.json` or the lockfile.

## What to build

### 1. The screen `/chat`
- Thread of user and assistant messages, newest at the bottom, auto-scroll that does not fight a user who has scrolled up.
- Composer pinned to the bottom: textarea that grows to a few lines, Enter sends, Shift+Enter newlines, disabled while a reply streams, and it survives the on-screen keyboard at 390px (no layout jump, use `dvh` not `vh`).
- Assistant messages render as readable text (paragraphs and line breaks are enough; do not pull in a markdown library).
- A streaming indicator while waiting for the first `text` delta.

    40|### 2. The stream client (`components/chat/use-chat-stream.ts` or similar)
- `fetch("/api/chat", { method: "POST", body: JSON.stringify(ChatRequest.parse({ sessionId, message })) })`, read `response.body` with a `TextDecoder`, split on `\n`, keep the partial tail in a buffer, and parse each complete line with `ChatStreamEvent.safeParse`. Ignore blank lines; ignore (do not crash on) a line that fails to parse, and count it so a bug is visible in the console.
- Append `text` deltas in order. Collect `citation` events per assistant message and render them as chips below it: "file title p.3" if you have a title, otherwise "page 3", linking to `deepLink` (and falling back to `notePath(fileId, page)`), opening the viewer at that page.
- On `done`, store `sessionId` in component state and send it with the next message.
- On `error`, or an HTTP error, or an aborted stream: show the message inline, keep the user's typed text recoverable (do not clear the composer on failure), and offer retry.
- Abort the fetch when the component unmounts.
- A 401 response means the session expired: send the user to `/login?next=%2Fchat`.

    50|### 3. Dev fixture (temporary)
`/api/chat` does not exist yet. Behind `process.env.NEXT_PUBLIC_PLUTO_CHAT_FIXTURE === "1"` **and** `process.env.NODE_ENV !== "production"`, drive the exact same code path from a local NDJSON fixture (a `ReadableStream` you build in `components/chat/fixture-stream.ts`) that emits a few `text` deltas, two `citation` events and a `done`, with small delays. Keep it to one file, no route, no change to the production path. The orchestrator deletes this file before the milestone PR, so nothing else may import it.

## Acceptance checks (run them, paste the output in the PR)
```
npm run typecheck                 # exit 0
npm run lint                      # exit 0
npm test                          # 136+ passed, 0 failed
npm run build -w @pluto/web       # succeeds; /chat listed
```
Manual (dev server on 3104, browser at 390px, signed in as the demo student):
    60|1. `NEXT_PUBLIC_PLUTO_CHAT_FIXTURE=1`: send "summarise my History 105 notes" -> text appears progressively, two citation chips appear, clicking one opens `/notes/<fileId>?page=<n>` at that page.
2. Fixture `error` event -> the message shows inline, the composer still holds the text, retry works.
3. Without the flag (`/api/chat` still missing): sending shows a readable error, not a blank screen or an unhandled rejection.
4. 390px: composer pinned, no horizontal scroll, keyboard open does not hide the input; long messages wrap.
5. Second message in the same thread sends the `sessionId` from the first `done` (show it from the network tab or a console log you remove afterwards).

Add a unit test for the NDJSON parser if it is quick (split across chunk boundaries, partial line, bad line) — `packages/core/test` is not yours, so put it under `apps/web` only if a test runner is already wired there; otherwise skip it and say so in the PR.

## Contract items touched
`ENDPOINTS.chat`: `ChatRequest`, `ChatStreamEvent`, `CHAT_STREAM_CONTENT_TYPE`, and the deep-link format. Consumer side only, no shape changes. If the stream contract looks wrong or insufficient, **stop** and tell the orchestrator; it goes to the director.
    70|
## Rules
- Commit small, push after every commit (`git push -u origin agent/web-chat` the first time).
- **Open the PR and stop. Never merge it** (no `gh pr merge`, no local merge into `agent/web`, no push to `agent/web`). Grokbot reviews, UI-tests and merges every PR; a coder that merges its own work skips that review.
- Never commit `.env.local` or a secret.
- Stay in the files listed above. The chat route, the agent package and the SMS simulator are other people's slices.

## PR body
Use `.github/PULL_REQUEST_TEMPLATE.md`: summary, build step and contract items, real output tails, merge-gate checkboxes, and "How to UI-test (for grokbot)" with the numbered steps above, stating clearly that the fixture flag is dev-only and is removed before the web milestone PR.

When the PR is open, reply `DONE` with the PR URL.
