# Report: chat/notes automated e2e (handoff `HANDOFF-chat-notes.md`)

Branch `agent/chat-e2e` (from `origin/main` 4b21df5, which includes #55 and #64). Run date 2026-11-14.

## How to run

- `npm run e2e:chat`: scenarios 1-9, `PLUTO_LLM=mock`. Starts its own `next dev` on 3500, signs in with puppeteer-core + system Chrome (390x844), cleans up only the rows it created, stops the server. Exit 1 on any failure. Screenshots and `server.log` in `.e2e-artifacts/<run>/` (gitignored).
- `npm run e2e:chat -- --llm gemini`: scenarios 10-12, real Gemini. Run once per change to `packages/agent`.
- Flags: `--port`, `--base-url <url>` (reuse a running server), `--only 1,4`.
- Needs the local stack and `apps/web/.env.local` (`npm run env:local -- --port 3500`). Refuses a non-local `SUPABASE_DB_URL`.
- Scenario 13 is in `npm test` (`packages/canvas/test/files/files-sync.db.test.ts`). Scenario 14: `npx tsx scripts/canvas/probe-files.ts` (GET only).

## Results

| # | Scenario | Result |
| --- | --- | --- |
| 1 | Vague request -> card with real classes, Send gated, reply with headings, no `http`, chips, saved chip + DB row | PASS |
| 2 | Study guide suggestion chip -> `<class> study guide` | PASS |
| 3 | Topic request -> no card, direct answer | PASS |
| 4 | `/notes` lists the note under its class ("Saved by chat or AI"); detail renders Markdown; chip opens `/notes/<fileId>?page=<n>` | PASS |
| 5 | Delete: Cancel keeps (UI + DB), confirm removes (UI + DB) | PASS |
| 6 | Stop: client (held request) and server side (DB has only the user message, no note) | PASS |
| 7 | "what's due this week?" -> answer, no saved note | PASS |
| 8 | SMS sim: plain-text "Which class? ...", no card; cited answer has the magic link | PASS |
| 9 | Other student: not-found on the detail page, forged delete leaves the note; `rls.test.ts` 15/15 | PASS |
| 10 | Gemini: both vague requests -> questions card | PASS (4 runs) |
| 11 | Gemini: next exam, then "check 151" -> real answer, no fallback | PASS (4 runs) |
| 12 | Gemini: study guide under 25 s | PASS (4 runs, 7.8-16.4 s) |
| 13 | Files tab 403 -> module PDFs downloaded and ingested by `syncCanvasFiles` | PASS (new test; fails if module listing returns nothing) |
| 14 | Live probe | 39 / 34 / 15 / 0 PDFs, as expected |

Unit/DB: `npm test` 585 tests pass; `npm run typecheck` and `npm run lint` pass.

## Bugs found and fixed

- Gemini study guides showed raw LaTeX (`$\text{CO}_2$`) and literal `---` lines. Fix: the web prompt forbids LaTeX and asks for Unicode (CO₂); `MarkdownText` renders `---` / `***` / `___` as a rule. Scenario 10-12 now fail on raw LaTeX or rule lines in the rendered reply.
- `stripLinks` left `(see )`, `(p. 2, )`, `( )` and a stray `)` for URLs that contain parentheses. Fixed, with `packages/agent/test/links.test.ts`.

## Findings (no change made)

- COMPSCI 328 (41896): no modules, no Pages tab, `/files` 403, empty syllabus; 18 HTML sources scanned (announcements, assignments, quizzes, syllabus) hold 0 file links and 0 PDF links. A 2026-09-09 announcement says materials and discussion are on Piazza. Nothing in Canvas to read.
- `DEFAULT_MAX_FILES` = 25: a first sync of the 88 real PDFs ingests 25 and leaves 63 pending with no message; each later manual sync takes the next 25 (4 syncs total). Rows that fail every time keep using the cap.
- The server-side stop check holds a `SHARE` lock on `chat_messages` for about 2 s per run, so other local sessions' chat inserts wait that long.

## Allen's decisions, applied

- Hosted DB: migrations `20261114050000_saved_notes` and `20261114060000_mcp_saved_notes` pushed (dry run listed exactly these two, no seeds). Read-only check after: `saved_notes` exists with RLS on, three own-row policies, no `anon` grants, `source` column present. Production `/notes` no longer returns the server error.
- Chat source chips now read "<file title> p.<n>" like saved notes: the `citation` stream event has an optional `title` (contract + `docs/plan.md`), filled from the student's own `files` rows. Mock scenarios 1-2 check every chip label against the DB.
- Canvas files sync cap raised from 25 to 100 per run.
- COMPSCI 328 counts as "no Canvas materials". Saving every finished cited answer is confirmed. Both are in the `docs/plan.md` decision log.
- MCP sign-in from claude.ai showed "Request not found": hosted Supabase Auth `site_url` was still `http://localhost:3000`, so Supabase sent the consent step to the local app, which can't see hosted authorization requests. With Allen's approval, hosted `site_url` is now `https://pluto-allens-projects-4833779e.vercel.app` (as `docs/plan.md` already required). A probe `/oauth/authorize` now redirects to production `/oauth/consent`, which sends a signed-out user to `/login`.
