# Web orchestrator plan

Branch `agent/web`, worktree `C:/Pluto-web`, port 3100 (coders 3101-3109), migration range `20261114010000`-`20261114015959` (web expects **no** migrations; if a task seems to need one, stop and escalate to the director).

Task file: `orchestrations/files/10-web.md`. Build steps 5 (UI half), 6, 7, 11. Protocol: `orchestrations/files/PROTOCOL.md`. Contract: `docs/plan.md` + `packages/core/src/contract.ts`.

## Baseline verified on `agent/web` before planning (F1 + foundation-tools merged)

```
$ npm install                      -> added 421 packages, audited 430
$ npm run typecheck                -> exit 0 (@pluto/web, @pluto/core, scripts)
    10|$ npm run lint                     -> exit 0
$ npm run env:local -- --port 3100 -> wrote apps/web/.env.local (port 3100, 11 secrets)
$ npm test                         -> Test Files 11 passed (11) | Tests 136 passed (136)
```

What already exists (do not re-create): `apps/web/proxy.ts` (session refresh + signed-out redirect to `/login?next=...`), `apps/web/lib/supabase/{server,client,admin,fetch}.ts` (all with a 10 s timeout), `apps/web/lib/env.ts`, `apps/web/app/(app)/{layout,page}.tsx` (placeholder), `apps/web/components.json` (shadcn initialised, slate, `@/components`, lucide), Tailwind 4 via `app/globals.css`.

What is still missing from the foundation (F2, arrives via `origin/agent/pluto`): synthetic lecture PDFs + `files`/`file_pages` rows (`scripts/seed.ts seedFiles()`), `/api/ingest`, magic-link helpers (`createMagicLink`, `consumeMagicLink`), `sendSms`, ICS builder, smoke files. `supabase/seed.sql` seeds **no** `files` rows yet, so the notes screens have no data until F2 lands.

## Dependency shape

    20|```
W1 web-shell (login + nav + PWA + ui primitives + all deps)   <- prerequisite, nothing runs beside it
      |
      +--> W2 web-notes   (/notes, /notes/[fileId] viewer)      needs F2 files for real data
      +--> W3 web-grades  (/api/grades, /grades, /deadlines)    needs nothing beyond seed
      |
      +--> W4 web-chat    (/chat streaming UI + citations)       real /api/chat lands with assistant
      +--> W5 web-open    (/open/[token])                        needs F2 consumeMagicLink
      |
      +--> W6 polish + milestone report (orchestrator)
```

    30|Concurrency: **max 2 coders at once** (PROTOCOL 2c), and 1 while free memory is under 2 GB (it was 1.95 GB at planning time, with foundation and canvas coders running). Order: W1 alone -> W2 + W3 -> W4 + W5 -> W6.

W1 is the shared prerequisite: it owns `apps/web/package.json`, so it adds **every** dependency the later tasks need (pdf.js, shadcn/radix, lucide, cva) and all `components/ui/**` primitives. Later tasks then never touch `package.json` or the lockfile, which is what would otherwise conflict.

If grokbot has not merged W1's PR ~20 minutes after it is green, W2 and W3 are branched off `agent/web-shell` instead of `agent/web` (PRs still target `agent/web`); after W1 merges they merge `agent/web` back in. This is a deliberate deviation from PROTOCOL 2 to avoid stalling on the merge queue.

## Milestones (one PR into `agent/pluto` each)

| Milestone | Contents | Report |
| --- | --- | --- |
| M1 | W1 + W2 + W3: login with `next`, app shell, PWA, notes list, PDF viewer at page n, `/api/grades`, `/grades`, `/deadlines` | `orchestrations/reports/web-M1.md` |
    40|| M2 | W4 + W5 + W6: chat screen against the real `/api/chat`, `/open/[token]`, loading/error states, 390px pass, dev fixture removed | `orchestrations/reports/web-M2.md` |

## Tasks

Every brief lives at `orchestrations/tasks/web-<task>.md` (committed on `agent/web` before the worktree is created). Every task: branch `agent/web-<task>`, worktree `C:/Pluto-<task-name>`, PR into `agent/web`, push after every commit, mobile first at 390px, Tailwind + shadcn/ui, `PLUTO_LLM=mock`.

### W1 `web-shell` — login, app shell, PWA, ui primitives, deps
Port 3101. Model: Cursor `claude-sonnet-5-thinking-high` (auth-sensitive, mixed UI + server actions). Label PR `security-review` (login and sessions) -> fresh reviewer before grokbot.

Owns: `apps/web/app/login/**`, `apps/web/app/(app)/layout.tsx`, `apps/web/app/(app)/page.tsx`, `apps/web/components/ui/**`, `apps/web/components/app-nav.tsx`, `apps/web/components/pwa-register.tsx`, `apps/web/public/**`, `apps/web/app/manifest.ts` (or `public/manifest.webmanifest`), `apps/web/package.json`, `apps/web/lib/safe-next.ts`, root `package-lock.json`.
    50|
Acceptance:
- Signed out, `GET /` -> 307 to `/login?next=%2F`; signing in lands back on `/`.
- `/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dabc` returns to that exact path after sign-in; `next=https://evil.example`, `next=//evil.example` and `next=/\evil` all fall back to `/`.
- `/login?error=link` shows the expired/used link message.
- Nav reaches `/chat`, `/notes`, `/grades`, `/deadlines`, `/settings/canvas`, `/sms-sim` (the last four may 404 until their owners land them); sign out returns to `/login` and `/` then redirects back to login.
- `/manifest.webmanifest` 200 with name, icons (192 + 512), `display: standalone`; service worker registers on `/`; Lighthouse-installable not required.
- No horizontal scroll at 390px on `/login` and `/`.
- `npm run typecheck && npm run lint && npm test` green; `npm run build -w @pluto/web` succeeds.

### W2 `web-notes` — notes list and PDF viewer
    60|Port 3102. Model: Cursor `gpt-5.3-codex` (pdf.js in a Next 16 client component is the fiddly part).

Owns: `apps/web/app/(app)/notes/**`, `apps/web/components/notes/**`.

Acceptance:
- `/notes` lists the demo student's files grouped by course then week label, newest first, with ingest status; empty state when there are no files.
- `/notes/<fileId>?page=3` renders page 3 first, at 390px, with page jump and prev/next; `?page=0`, `?page=abc` and an out-of-range page fall back to page 1 (page numbers 1-based).
- The signed Storage URL is created server-side from the session client (RLS applies); another student's `fileId` gives a not-found page, never a PDF.
- Deep links from the contract (`/notes/<fileId>?page=<n>`) open the same view.

### W3 `web-grades` — grades endpoint, grades screen, deadlines screen
    70|Port 3103. Model: Cursor `composer-2.5` (mechanical, well-specified; the route is thin).

Owns: `apps/web/app/api/grades/**`, `apps/web/app/(app)/grades/**`, `apps/web/app/(app)/deadlines/**`, `apps/web/components/grades/**`, `apps/web/components/deadlines/**`.

Acceptance:
- `GET /api/grades` with the demo session returns `GradesResponse` exactly (validated with `GradesResponse.parse`); `?course=History%20105` filters; signed out -> 401; an unknown course -> 404 with a JSON error, never another student's data.
- `/grades` shows per course: each group's score and weight, the running weighted grade and the ungraded count, matching the endpoint output for the demo student.
- `/deadlines` lists upcoming assignments soonest first with the moved due date struck through for the seeded date change (`a0000000-0000-4000-8000-000000000101`).
- Both screens work at 390px and have loading and error states.

### W4 `web-chat` — chat screen
    80|Port 3104. Model: Cursor `claude-sonnet-5-thinking-high` (NDJSON streaming + citation UI).

Owns: `apps/web/app/(app)/chat/**`, `apps/web/components/chat/**`.

Acceptance:
- Posts `ChatRequest` to `/api/chat`, parses the NDJSON `ChatStreamEvent` stream (`text`, `citation`, `done`, `error`), renders text as it arrives and citation chips linking to `/notes/<fileId>?page=<n>`.
- Keeps the `sessionId` from `done` for the next message; `error` shows a readable message and leaves the typed text recoverable.
- Until `/api/chat` exists, a dev-only fixture (`NEXT_PUBLIC_PLUTO_CHAT_FIXTURE=1`, non-production only) drives the same code path. W6 deletes it before M2.
- Claude-style thread at 390px: input pinned to the bottom, no horizontal scroll, works with the on-screen keyboard.

### W5 `web-open` — magic-link open
    90|Port 3105. Model: Cursor `gpt-5.3-codex`. Label PR `security-review` (magic links, service role, sessions). **Blocked until F2's `consumeMagicLink` reaches `origin/agent/pluto`.**

Owns: `apps/web/app/open/**`.

Acceptance:
- A token from core `createMagicLink` redirects (302) to `/notes/<fileId>?page=<n>` with a session for that student in a fresh browser profile.
- The second use of the same token, an expired token and a garbage token all redirect to `/login?error=link`.
- The route never signs in a student other than the token's owner; service role is used only after the token verifies.

### W6 polish + milestone (orchestrator, or one Cursor coder if time allows)
Loading and error states on every screen, 390px pass on all screens, remove the chat fixture, write `orchestrations/reports/web-M<n>.md`, merge `origin/agent/pluto`, rerun all checks, open the milestone PR.
   100|
## Review and merge

- Every coder PR: grokbot reviews and merges. Nobody else merges.
- Fresh headless reviewer first, `security-review` label: W1 (login, sessions) and W5 (magic links, service role). W2, W3, W4 skip it.
- Reviewer command (one at a time, from the coder's worktree), per PROTOCOL 4: `cursor-agent -p --force --trust --model gpt-5.3-codex` with `REVIEW.md` and `.review/diff.patch`.
- After each merge into `agent/web`: `git pull`, then `npm run typecheck && npm run lint && npm test` here, plus the task's own manual check.

## Risks

| Risk | Handling |
| --- | --- |
   110|| No `files`/`file_pages` rows until F2 | W2 inserts one temporary `files` row for the demo student and uploads a locally generated PDF to `notes/<student_id>/<file_id>.pdf` in the shared local stack, tests, then deletes both. No PDF and no fixture row is committed. Re-verify against the real seed after F2 merges. |
| `/api/chat` does not exist yet (assistant slice) | W4 builds against `ChatStreamEvent` with a dev-only fixture; M2 is only opened after the chat screen has run against the real route. |
| `consumeMagicLink` not available | W5 stays queued; if F2 slips, M2 ships without it and W5 becomes its own PR. |
| Memory (16 GB machine, ~2 GB free) | 1 coder while under 2 GB free, 2 above; no `next dev` left running; coder tabs closed as soon as their PR merges. |
| Next 16 renamed middleware to `proxy.ts` and made `params`/`searchParams` promises | Every brief points at `apps/web/AGENTS.md` and `node_modules/next/dist/docs/`. |
| Lockfile conflicts between coders | Only W1 touches `apps/web/package.json` and `package-lock.json`. |
