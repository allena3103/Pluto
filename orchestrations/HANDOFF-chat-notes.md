# Handoff: web chat + saved notes + Canvas PDFs (QA and fixes)

Owner: Allen. Written 2026-11-14 ~21:30 EST for the next agent. Read root `CLAUDE.md` and `docs/plan.md` (decision log, last rows) first.

## Goal

Allen does not want to test this by hand any more. Your job:

1. Build an **automated end-to-end check** for the chat/notes features below and commit it.
2. Run it (local stack, mock and real Gemini), fix what fails, and keep it green.
3. Report what you ran, what failed, what you fixed. Stop and ask Allen for anything in "Needs Allen" below.

Done = every scenario in section 4 passes from one command, unit/DB tests pass, findings and fixes are in PRs.

## 1. What exists (all merged to `main`)

| Feature | PR | Main code |
| --- | --- | --- |
| Notes-based web replies saved to `saved_notes`, listed on `/notes` by class ("From chat"), detail page `/notes/saved/<id>`, X button + confirm to delete | #56 | `apps/web/lib/saved-notes.ts`, `apps/web/lib/chat-handler.ts`, `apps/web/app/(app)/notes/page.tsx`, `apps/web/app/(app)/notes/saved/[noteId]/*`, `apps/web/components/notes/delete-saved-note-button.tsx`, migration `supabase/migrations/20261114050000_saved_notes.sql` |
| No URLs in web replies (links are SMS only) | #56 | `packages/agent/src/links.ts` (`stripLinks`), web prompt in `packages/agent/src/gemini.ts`, mock in `packages/agent/src/mock.ts` |
| Stop button (aborts; server saves no reply and no note) | #56 | `apps/web/components/chat/chat-view.tsx`, `use-chat-stream.ts`, abort guard in `chat-handler.ts` |
| Clarifying questions (`ask_clarifying_questions`, 1-3 questions, tap options single/multiple, typed answer); stream event `questions` | #56, #58 | `packages/agent/src/clarify.ts`, `gemini.ts`, `mock.ts` (`runMockClassNotes`, `isVagueNotesRequest`), `apps/web/components/chat/clarifying-questions.tsx`, contract `ClarifyingQuestion` / `ChatStreamEvent` in `packages/core/src/contract.ts` |
| Markdown rendering of replies and saved notes (no HTML injection) | #56 | `apps/web/components/markdown-text.tsx` |
| No empty reply after the tool-round cap (one tool-free final turn) | #64 | `runGemini` in `packages/agent/src/gemini.ts` |
| Canvas PDFs read from Modules when `/courses/:id/files` is 403 (Files tab hidden) | #64 | `listCourseFiles` / `listModuleFiles` in `packages/canvas/src/client.ts`, `getObject` in `packages/canvas/src/http.ts` |

Answers to clarifying questions are sent as `<original request>\n\n<Question? answer lines>`; the user bubble shows only the answers. Saved-note title = reply's first heading, else first line of the request.

## 2. Needs Allen (do not do these yourself; ask)

- **P0: hosted DB is missing `saved_notes`.** Checked read-only 21:30: `to_regclass('public.saved_notes')` is null; latest hosted migration is `20261114041000`. Production `/notes` queries `saved_notes` and throws, so the Notes page is likely broken in production, and chat notes are never saved there. Fix is `npx supabase db push` against the hosted project (migration `20261114050000` sorts after every applied one, no `--include-all`). Verify first: load production `/notes`.
- **PR #55** (`agent/canvas-live`, open): adds the **Sync now** button and sync-after-save. Production has no UI to trigger a Canvas sync. Allen decides whether to merge (it also adds a `PLUTO_AUTO_LOGIN_DEMO` flag).
- Any production write (env vars, deploys, DB, sync). Exception already approved once: `POST /api/canvas/sync` with `x-internal-secret` for the demo student; ask again before repeating it.
- Merging to `main`.

## 3. Environments and gotchas

- **Local stack**: Supabase in Docker on 54321/54322. Docker on PATH in bash: `export PATH="/c/Program Files/Docker/Docker/resources/bin:$PATH"`. Write env: `npm run env:local -- --port <port>` (reads `C:/Pluto/.env.secrets`; never print or commit it). Pick a free port (3500 was used for testing). Never `supabase db reset`.
- **Do not touch** the servers already running: `localhost:3000` is `C:/Pluto-local` (another session, uncommitted edits, code from before #64) and `localhost:3210` is `C:/Pluto-canvas-live` (PR #55, also pre-#64). Allen was testing on these and saw stale behavior; that was not a bug in `main`.
- **Production**: `https://pluto-sepia.vercel.app`, Vercel project `pluto` in scope `<vercel-scope>` (`npx vercel@latest ... --scope <vercel-scope>`). `PLUTO_LLM` is set for Production only (value hidden; must be exactly `gemini`). On hosted, Allen's real Canvas courses belong to the **demo student** `11111111-1111-4111-8111-111111111111` (`demo@pluto.test`, password `PROD_DEMO_STUDENT_PASSWORD`). Read-only DB checks: `HOSTED_SUPABASE_DB_URL` with `begin read only`.
- **LLM modes**: `PLUTO_LLM=mock` is deterministic (use for the e2e default); `PLUTO_LLM=gemini` with `GEMINI_API_KEY` for a real-model pass. The exact text "I couldn't find that in your notes." only comes from the mock.
- **Browser automation**: the built-in `browser` tool's daemon failed on this machine. What worked: `puppeteer-core` in a temp dir driving system Chrome (`C:/Program Files/Google/Chrome/Application/chrome.exe`, headless, fresh `--user-data-dir`). Wait for hydration before typing (retry typing until `button[aria-label='Send message']` is enabled). Questions card submit: `form:has(fieldset) > button[type=submit]`. Delete X: `button[aria-label='Delete <title>']` (handle the `confirm` dialog). Stop: `button[aria-label='Stop reply']`.
- **Killing your dev server**: stopping `next dev` leaves a child `start-server.js` on the port; find it with `netstat -ano` and stop that PID only if its command line is in your worktree.
- **Memory** is tight (16 GB). One dev server at a time; stop it after each run.

## 4. Scenarios the automated check must cover

Put the runner in `scripts/e2e/chat-notes.mjs` (or a vitest project if you prefer) with `npm run e2e:chat` in root `package.json`. It must create its own data or clean it up (delete `saved_notes` rows and chat sessions it created) and be safe on the shared local stack. 390px viewport.

Mock LLM (deterministic, required):

1. Vague request "lets take a look at my class notes" -> questions card with the student's real class names; Send disabled until every question is answered; pick a class + week -> reply with headings, no `http` in the chat text, source chips, "Saved to Notes · <class>" chip.
2. "Make me a study guide from my latest notes" (suggestion chip) -> same flow; saved note title `<class> study guide`.
3. Request with a topic ("show me my notes on the printing press") -> no questions, direct answer.
4. `/notes` shows the saved note under the right class in "From chat"; the detail page renders Markdown and source chips that open `/notes/<fileId>?page=<n>`.
5. X button: cancel keeps the note; confirm removes it from the list and the DB.
6. Stop: hold `/api/chat` (request interception) and press Stop -> "You stopped this reply.", Send button returns. Then a real server-side stop: let a request reach the server, abort it, assert the DB has only the user message for that session and no saved note.
7. Non-notes question ("what's due this week?") -> answer, no saved note.
8. SMS path (`/sms-sim` or `handleSmsInbound` directly): vague notes request gets a plain-text "Which class? ..." and no card; a cited answer still carries the magic link.
9. Another student cannot see or delete the first student's saved note (RLS is covered in `packages/core/test/db/rls.test.ts`; just keep it green).

Real Gemini (run once per change to `packages/agent`, not in CI):

10. "lets take a look at my class notes" and "summarize my notes" -> `ask_clarifying_questions`, not a text question.
11. "when is my next exam" then "check <course number>" -> a real answer or a plain "not found" sentence, never "I couldn't put an answer together just now."
12. "build me a study guide with this weeks notes" -> question -> study guide under 25 s total (chat timeout is 25 s; a full guide took ~20 s on `gemini-3.5-flash-lite`).

Canvas (unit/fixture level; live only read-only):

13. `/files` 403 -> module files are read and PDFs kept (test exists in `packages/canvas/test/client/forbidden.test.ts`). Add a files-sync level test that module-sourced files are downloaded and ingested.
14. Optional read-only live probe with `CANVAS_API_TOKEN`: `listCourseFiles` for the 4 real course ids (passed as arguments). Expected now: 39 / 34 / 15 / 0 PDFs.

## 5. Known issues to triage

- Production `/notes` likely broken until the hosted migration is applied (section 2).
- A sync run ingests at most 25 PDFs (`DEFAULT_MAX_FILES` in `packages/canvas/src/files-sync.ts`); nothing re-runs it automatically.
- One real course has no modules and a 403 on files, so 0 PDFs. Check whether its PDFs are reachable another way (Pages, Announcements, Syllabus) before calling it done; ask Allen if it needs scope.
- `stripLinks` leaves a stray `)` after a bare URL inside parentheses (cosmetic).
- The mock only sees the current message plus the "Question? answer" lines; it is a test double, not product behavior.
- Saved notes are created only for finished replies that cite notes pages; replies that end early (`partial`) are not saved. Confirm this matches what Allen expects.

## 6. Process

- Branch from `origin/main` in your own worktree (`C:/Pluto-<name>`, branch `agent/<name>`). Small commits, push after each.
- Before every PR: `npm run typecheck`, `npm run lint`, `npm test` (DB tests need the local stack and `apps/web/.env.local`). Paste the real output tails in the PR body.
- PRs touching migrations/RLS, auth, service-role or internal-secret routes, or Canvas token handling get the `security-review` label and a fresh reviewer following `REVIEW.md`.
- Don't merge; Allen merges or tells you to.
- Final report: scenarios with pass/fail and evidence (command output, screenshots paths), bugs found, fixes and PR links, open items for Allen.
