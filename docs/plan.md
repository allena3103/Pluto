# Pluto — HackUMass architecture and plan

Nov 12, 2026 · @Allen

Source of truth for the contract (MCP tools, internal API, data model). Only the director edits this file; every change is logged in "Decision log" at the bottom.

## Scope

The judges should remember one moment: in Claude, a student types "build me a study guide from my History 105 notes from the past 2 weeks, use Pluto," and Claude pulls the real notes through the Pluto MCP and writes the guide, with no downloading or pasting.

**Build (the vertical slice)**

- Canvas sync of courses, assignments and lecture PDFs (Allen's own courses plus seeded demo data)
- PDF ingestion with page-level search, so every answer can point to an exact page
- Pluto MCP server with login, connected to Claude
- Web dashboard: Claude-style chat, weighted grade view, PDF viewer that opens to a page
- SMS reply (reactive): student texts a question, Pluto texts back a link to the exact notes page
- One scripted proactive alert: a button or timer on the demo student sends the "heaviest crunch week" text with an ICS calendar link

* Deadline-change alerts: every Canvas sync compares due dates with the last saved copy, and Pluto texts the student when one moves (the demo uses a seeded date change)
* One MCP server that connects to both Claude and ChatGPT, shown in the demo

**Cut for the hackathon (show on a roadmap slide)**

- Gradescope scraping, Piazza, Brightspace and Moodle
- Canvas inbox sync (only if Canvas sync is done early)
- iMessage group chats
- Full autonomous crunch-week scanning across a whole semester
- Apple and Google calendar write access (an ICS link replaces it)

## Architecture at a glance

&#91;embedded content: architecture · 3 surfaces, core, database, integrations\]

Claude, ChatGPT, the web app and SMS all reach one core backed by one database, so a note found by text opens the same page in the web app.

## Stack

Use well-known tools so one person can move fast; the one real choice is search, where Postgres full-text comes before any embeddings service.

| Layer | Choice | Why |
| --- | --- | --- |
| Web app | Next.js (React) on Vercel, installable as a PWA | One codebase for laptop and phone; home-screen install with no app store |
| Auth and database | Supabase Auth, Postgres, Storage; local Supabase (Docker) for development, hosted project for deploys | Postgres holds courses, grades and page text, Storage holds the PDFs |
| Note search | Postgres full-text search, one row per PDF page | Fastest to build and no extra service; add vector search only if time remains |
| PDF handling | Per-page text extraction on upload; pdf.js viewer that opens to a page number | Page-level answers are the feature |
| Agent | Google Gemini API (`@google/genai`) with function calling, one agent loop shared by web chat and SMS | Gemini is a hackathon sponsor; same tools as the MCP, so every surface behaves alike |
| MCP server | TypeScript MCP SDK (streamable HTTP) served from the Next.js app at `/api/mcp` on Vercel; Supabase Auth OAuth 2.1 server with dynamic client registration; consent page at `/oauth/consent`; demo-student bearer token fallback | One deployment and one auth system; Claude and ChatGPT connect as custom connectors; access tokens respect row-level security |
| SMS | Sendblue free sandbox (iMessage/SMS, no approval needed); Twilio Virtual Phone or a dashboard SMS simulator as fallback | Twilio toll-free verification needs review time, so it will not clear before kickoff. Sandbox limits: 10 verified contacts, and each person must text the number first; Pluto can then reply for 24 hours |
| Calendar | ICS feed link per student | Works with Apple and Google Calendar with no calendar OAuth |
| Repo and CI | One GitHub repo, npm workspaces, typecheck, lint and tests on every push; Tailwind + shadcn/ui for the web UI | Catches breakage early with many parallel agents |

## Data model outline

Ten groups of data, and every row belongs to one student with row-level security on, so a student only ever sees their own rows.

| Table | Holds | Main fields |
| --- | --- | --- |
| profiles | One row per student | name, phone number for SMS, encrypted Canvas token |
| courses | A student's courses | name, term, Canvas course id |
| assignments | Deliverables | course, title, due date, previous due date, date-changed time, points, weight group, score, graded or not, instructions (Canvas description as plain text), Canvas link |
| assignment\_files and assignment\_file\_pages | Files linked from an assignment's Canvas instructions (handouts, case questions); kept apart from notes: never on the Notes page or in notes search | assignment, file name, type (`pdf`, `docx` read; `other` listed only), storage path, ingest status, page text |
| grade\_groups | Weighting rules | course, group name (homework, exams), weight percent |
| files | Lecture PDFs and syllabi | course, title, week label, added date, source (Canvas or manual), storage path, ingest status |
| file\_pages | Searchable text | file, page number, page text, search index |
| chat\_sessions and chat\_messages | Web and SMS conversations | session, role, text, cited file and page, channel |
| saved\_notes | Study guides and summaries built from notes: web chat answers, and guides Claude saves through the MCP `save_study_guide` tool; shown on the Notes page by class | class (null when the answer cites several), chat session (null for MCP saves), source (`chat` or `mcp`), title, body, cited file pages |
| magic\_links | One-time links sent by SMS | token, student, target (a file page or a saved note, exactly one), expiry |
| alerts | Proactive alerts | student, kind (crunch week or date change), week or assignment, message, sent time, calendar feed token |

## MCP contract

Eight read-only tools plus one write tool, `save_study_guide`. The write tool can only add a saved note for the signed-in student and text that student; it never edits or deletes anything.

| Tool | Inputs | Returns |
| --- | --- | --- |
| list\_courses | none | course id, name, term |
| get\_recent\_notes | course (name or id), days (default 14) | every file added in the window: title, week label, date, page text in order, a truncated flag, deep link |
| get\_note\_pages | file id, optional first and last page | text of those pages with page numbers |
| search\_notes | query, optional course, limit | matching pages: file, page, short snippet, deep link |
| get\_deadlines | optional course, days ahead (default 30) | assignment id, title, due date, previous due date if it moved, points, weight group, status, attachment count |
| get\_assignment | assignment id (from get\_deadlines) | title, class, due date, points, status, instructions text, web link `/assignments/<id>`, attachments (name, type, status, page count, web link, page text), a truncated flag (60,000-character cap shared by instructions and attachments) |
| get\_grades | optional course | score and weight per group, running weighted grade, count of ungraded items |
| get\_crunch\_weeks | weeks ahead (default 8) | weeks ranked by number and weight of deliverables due (stretch; also feeds the SMS alert) |
| save\_study\_guide (write) | title (1-200 chars), markdown body (1-60,000 chars) that cites pages with deep links, optional course (name or id) | saved note id, title, class name or null, web link to the saved note, number of cited pages kept, text status (`sent`, `no_phone` or `failed`) |

- **Auth:** the student signs in with their Pluto account through OAuth; every call is scoped to that student.
- **Size rule:** get\_recent\_notes stops at a fixed text cap and sets the truncated flag; Claude then calls get\_note\_pages for the rest.
- **Citations:** every result carries a deep link to the exact page in the web app, so the study guide can cite pages.
- **Changes:** a tool name or field changes here first, then in code.
- **Write tool rules (`save_study_guide`):**
  - Inserts one `saved_notes` row with `source = 'mcp'` for the signed-in student, then texts that student's linked phone a magic link that opens the saved guide. A failed or skipped text never undoes the save.
  - Cited pages are the deep links (`/notes/<fileId>?page=<n>`) in the body that point at the student's own files and existing pages; anything else is dropped without being read. At most 100 kept.
  - Class: the `course` input when given (resolved like every other tool, `course_not_found` otherwise); else the class every cited file shares; else none.
  - Limit: 10 MCP saves per student per rolling hour; the 11th returns the `rate_limited` tool error and saves and texts nothing.
  - Works on every MCP auth method (OAuth, demo bearer, demo URL token). OAuth inserts with the student's own token under RLS; the demo methods use the service role with an explicit `student_id`. The text step (magic link + SMS) uses the service role, created only after auth succeeded and the row exists, with the student id from auth, never from tool input.
  - Published with `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`. Not offered to the web or SMS agent (web chat already saves its own notes).
- **Prompts:** the server publishes three MCP prompts (read-only text templates; clients show them as one-click options):

| Prompt | Arguments | Asks the model to |
| --- | --- | --- |
| study\_guide | course (required), days (optional, default 14) | read the course's recent notes (`get_recent_notes`, then `get_note_pages` when truncated), write a study guide citing every fact with its deep link, then save it with `save_study_guide` |
| cram\_plan | weeks (optional, default 8) | find the heaviest week (`get_crunch_weeks`), read what is due (`get_deadlines`), find the notes for each item (`search_notes`), and write a day-by-day plan with page links |
| quiz\_me | course (required), topic (optional), count (optional, default 8) | write a practice quiz from the notes, answers at the end, each answer linking to the exact page it comes from |

* **Client support:** standard remote MCP over streamable HTTP at `/api/mcp` with OAuth, so Claude, ChatGPT and Cursor connect to the same server. Test ChatGPT at build step 4; the live demo runs in Claude.

## Internal API contract

Ten endpoints connect the web app, the agent and the integrations; settle each one's field-level shapes before building it.

| Endpoint | Called by | In | Out |
| --- | --- | --- | --- |
| /api/ingest | Canvas sync, manual import | file id | status; fills file\_pages |
| /api/chat | web chat view | session id, message | streamed reply with cited file and page; clarifying questions when details are missing; saved-note notice |
| /api/agent/reply | SMS webhook | student id, text, channel | reply text and optional deep link |
| /api/grades | web grade view | optional course | same data as get\_grades |
| /api/magic-link | the agent, internally | student id, file id, page | one-time URL |
| /open/:token | a phone tapping the link | token | signs the student in, opens the PDF at the page, or the saved note for a saved-note link |
| /api/sms/inbound | Sendblue | incoming message | finds the student by phone, calls agent/reply, texts the answer. A YES-style reply within 24 hours of a sent crunch-week alert gets a study plan for that alert's week, built by the same agent and tools |
| /api/alerts/demo | the demo button | student id | sends the crunch-week SMS with a calendar link, ending with "Want a plan? Reply YES." |
| /cal/:token.ics | Apple or Google Calendar | feed token | study blocks as a calendar feed |
| /api/alerts/deadline-change | Canvas sync, after each sync | student id, assignment id, old and new due date | texts the student the new date with a calendar link |

## Build order

Built by a director, five orchestrators and their coders in parallel (see `orchestrations/files/`). The demo path comes first, so if time runs short, cut from the bottom.

1. **Schema and seed.** Supabase tables with row-level security, plus one seeded demo student (courses, assignments, grade groups, a few lecture PDFs). Done when a second test student cannot read the first student's rows.
2. **PDF ingest and search.** /api/ingest fills file\_pages, with full-text search on page text. Done when a query returns the right file and page.
3. **MCP server in Claude.** The read-only tools with OAuth, connected to Claude as a custom connector (get\_crunch\_weeks can wait). Done when Claude builds a study guide from the seeded notes. Record a backup video as soon as this works.
4. **ChatGPT on the same server.** Done when ChatGPT lists courses through the MCP. If it fights back, drop it and move on.
5. **Agent loop and web chat.** /api/agent/reply, /api/chat, login, and the chat screen. Done when web chat answers with a cited file and page.
6. **PDF viewer and magic links.** /api/magic-link and /open/:token. Done when a link opens the right PDF at the right page on a phone.
7. **Grades.** /api/grades and the weighted grade view.
8. **SMS through Sendblue.** /api/sms/inbound. Done when a text gets back an answer with a link that opens the notes page.
9. **Alerts and calendar.** /api/alerts/demo, /api/alerts/deadline-change with one seeded date change, and /cal/:token.ics.
10. **Live Canvas sync.** Real sync of Allen's courses; until it works, the seeded data stands in.
11. **Polish.** PWA install, loading and error states, get\_crunch\_weeks.
12. **Freeze.** No new features: fix bugs, rehearse, refresh the backup recording, submit.

After every step, run the end-to-end smoke test on the demo student before starting the next one.

## Working agreement

Every change is written by one coder agent and reviewed and merged by grokbot (Allen's GitHub reviewer). Security-sensitive changes also get a fresh reviewer agent that has never seen the work. Full process: `orchestrations/files/PROTOCOL.md`.

1. **Coder agent.** One session per task in its own worktree and herdr tab, given CLAUDE.md, this contract and that one task.
2. **Self-check.** Before a pull request, typecheck, lint and tests pass, and the coder lists which contract items it touched.
3. **Fresh reviewer, security PRs only.** PRs touching migrations/RLS, auth, magic links, the SMS webhook, service-role or internal-secret routes, or Canvas token encryption are labeled `security-review` and get a fresh headless reviewer (only goals, contract and diff, using REVIEW.md) before grokbot. It reports BLOCKING or NON-BLOCKING and fixes nothing.
4. **Blocking means** a bug, a contract mismatch, a missing auth or row-level-security check, or a secret in code. Style and naming never block.
5. **Limit.** One fix round and one re-review. Still open: security and contract items go to the director, then Allen.
6. **Merge.** Grokbot merges coder PRs into orchestrator branches and milestone PRs into `agent/pluto`, only when CI is green (and the fresh review approved, if labeled). After each merge the owner reruns the checks on the merged branch. `agent/pluto` into `main`: director opens the PR, Allen merges.
7. **Contract changes.** Only the director edits this doc, then the code follows.

Before kickoff, confirm that the event allows AI-assisted coding; this plan assumes it does.

## Agent instructions

Live in the repo root: `CLAUDE.md` (every agent) and `REVIEW.md` (fresh reviewers).

## Risks and fallbacks

The two that can sink the demo are Claude connector sign-in and the SMS sandbox limits, so both are tackled first.

| Risk | Fallback |
| --- | --- |
| Canvas token disabled or rate-limited | Seed demo data from files already downloaded; the demo does not need live sync |
| Claude connector sign-in eats hours | It is build step 3, before any web work; fallback is a single demo-student token for the connector |
| SMS sandbox limits | Use the Sendblue sandbox: tested two-way (inbound webhook and reply) with 10 verified contacts and a 24-hour reply window after each inbound text. Cold outbound is untested, so send the crunch alert while the demo phone's window is open. Fallback: the dashboard SMS simulator or the Twilio Virtual Phone. Twilio toll-free verification stays submitted for after the event |
| PDFs with image-only slides give no text | Choose demo PDFs with selectable text; check this before kickoff by trying to select text in a PDF viewer |
| Study-guide request returns more text than fits | Text cap with a truncated flag; Claude pulls the rest with get\_note\_pages |
| Scope creep | Feature freeze once the demo path works end to end; the cut list stays cut |
| Live demo fails (Wi-Fi, sign-in) | Backup screen recording of the full flow, made as soon as the demo path works |
| Real course material in a public demo | Use only your own courses, keep PDFs out of the repo, show them only in the demo |
| ChatGPT will not connect (plan, mode or OAuth differences) | Test at build step 4; if it fails, demo Claude live and show ChatGPT from a short recording, or drop the claim from the pitch |
| Date-change detection misfires | Compare only due date and title against the last saved copy; demo with one known change in the seeded course |

## Decision log

Director-owned. Newest last.

| Date | Decision |
| --- | --- |
| 2026-11-13 | Building at the event; ~36h to submission; feature freeze 6h before. |
| 2026-11-13 | MCP served from the Next.js app at `/api/mcp` on Vercel instead of a separate service. |
| 2026-11-13 | MCP auth: Supabase Auth OAuth 2.1 server (dynamic client registration, consent page `/oauth/consent`); fallback bearer `PLUTO_DEMO_MCP_TOKEN` maps to the demo student. |
| 2026-11-13 | Local Supabase in Docker for development; hosted Supabase + Vercel for deploys and grokbot UI checks. |
| 2026-11-13 | Seed notes are synthetic, text-based lecture PDFs committed to the repo; Allen's real PDFs are uploaded only for the demo and never committed. |
| 2026-11-13 | Tool and endpoint shapes live as zod schemas in `packages/core/src/contract.ts`; this doc stays the human-readable source and the two must agree. |
| 2026-11-13 | Data model adds `sms_messages` (simulator store and SMS log). |
| 2026-11-13 | `packages/core` owns shared helpers used by several surfaces: magic links, `sendSms` (simulator + Sendblue), ICS builder, deep links. Deep-link format `/notes/<fileId>?page=<n>`, 1-based. |
| 2026-11-13 | Mocks for keyless development: `PLUTO_LLM=mock`, `SMS_PROVIDER=simulator`, `CANVAS_MODE=fixtures`. |
| 2026-11-13 | Agent loop (web chat + SMS) uses the Google Gemini API instead of the Anthropic API (Gemini is a sponsor). Env: `GEMINI_API_KEY`, `GEMINI_MODEL`; `PLUTO_LLM=mock|gemini`. Claude stays the MCP client in the demo. |
| 2026-11-13 | `/api/alerts/demo` accepts either the signed-in student's session (studentId must equal the session user) or `INTERNAL_API_SECRET` (for a timer). |
| 2026-11-14 | Grokbot reviews, UI-tests and merges every PR (coder and milestone). Fresh reviewer agents only for `security-review` PRs (migrations/RLS, auth, magic links, SMS webhook, service-role/internal-secret routes, Canvas token encryption). Merge gate is CI green (+ APPROVE if labeled); GitHub can't enforce it on this private free repo. CI runs the database tests against a Supabase stack. |
| 2026-11-14 | F1 choices accepted (details: `orchestrations/reports/foundation-F1.md` section 2): composite `(student_id, id)` foreign keys; `magic_links` stores a SHA-256 token hash, service role only; `search_notes(p_student_id, p_query, p_course_id, p_limit)` security invoker; ICS source is `study_blocks`, feed token `alerts.calendar_feed_token`; storage path `notes/<student_id>/<file_id>.pdf`, PDFs up to 50 MB; internal secret header `x-internal-secret`; `/api/chat` streams NDJSON events `text`, `citation`, `done`, `error`; `get_recent_notes` cap 60,000 chars with `pagesIncluded`/`pageCount`, `get_note_pages` also has `truncated`; session refresh in `apps/web/proxy.ts` (Next 16). |
| 2026-11-14 | The proxy treats every `/api/*`, `/open`, `/oauth`, `/cal` path as public; each such route must authenticate the caller itself (session, internal secret, webhook secret, MCP token or feed token). |
| 2026-11-14 | PR #9 hardening: students can't write `files` rows (server only), `files.storage_path` must equal `<student_id>/<file_id>.pdf`, and students may update only `profiles.name`. Next foundation migration number is `20261113000600`. |
| 2026-11-14 | Sign-up: `/signup` page (web slice) with name, email and password via `supabase.auth.signUp` (name in user metadata; the existing trigger creates the profile). Email confirmation is off for the hackathon (local `config.toml` already; Allen turns it off on the hosted project). Linked from `/login`; validated `next` carries through. |
| 2026-11-14 | Phone linking proves ownership and fits the Sendblue sandbox rule that the person texts first: `/settings/phone` (web slice) shows a short single-use code from `POST /api/sms/link-code` (assistant slice, signed-in; stores a hash with 15-minute expiry in a new `phone_link_codes` table, assistant migration range). The student texts `LINK <code>` to the Pluto number; `/api/sms/inbound` matches the code and sets `profiles.phone` = `from_number` with the service role. No other path writes `profiles.phone` except the seed. |
| 2026-11-14 | MCP demo fallback for claude.ai (its connector screen has no custom headers): `/api/mcp/demo/<token>` serves the same 7 read-only tools as the demo student only, enabled only when `PLUTO_DEMO_MCP_URL_ENABLED=1`, constant-time compare against `PLUTO_DEMO_MCP_TOKEN`, off by default, on only for the demo deployment, token rotated after the demo. The header form `Authorization: Bearer` stays for Inspector, Claude Code and Desktop. OAuth remains the primary path. |
| 2026-11-14 | Local OAuth round trip runs the web app on port 3000 (`site_url` in `supabase/config.toml`); no config change. Hosted `site_url` is `APP_URL`. |
| 2026-11-14 | Shared `apps/web/package.json`, `apps/web/next.config.ts`, `package-lock.json` and `.env.example`: any slice may make small additive edits (one dependency, one config line, one env var) and must list them in the PR body; lockfile conflicts are resolved in sync PRs with `npm install`. |
| 2026-11-14 | Plan from Sat 10:00: revised timeline in `orchestrations/files/BRIEF.md`; milestone PRs into `agent/pluto` about every 2 hours, merged by grokbot with a merge commit (not squash); after each, the director opens `agent/pluto` -> `main` and Allen merges it to deploy on Vercel (root `apps/web`). Foundation planner retires after F2; the director then owns `packages/core/**`, `supabase/config.toml`, CI and root configs. |
| 2026-11-14 | From 12:05: branches are flat (coders branch from and PR into `agent/pluto`, merge commits), no slice planners, Claude-only agents. Grokbot is replaced by the `mergebot` Claude agent (`orchestrations/files/MERGEBOT.md`) with the same gate. Plan: `orchestrations/plans/director.md`. |
| 2026-11-14 | Gemini models: web chat `GEMINI_MODEL`, SMS `GEMINI_FAST_MODEL`, both default `gemini-3.5-flash-lite` (`gemini-3.8-flash` timed out and `gemini-3.5-flash` took ~11s per call on 2026-11-14). |
| 2026-11-14 | `/api/mcp` accepts any valid Supabase access token for the student (web session or OAuth-issued); tokens are not audience-bound to `/api/mcp`. The demo bearer and URL token are unchanged. |
| 2026-11-14 | `POST /api/canvas/sync` (not one of the ten endpoints): signed-in student, or `x-internal-secret` with body `studentId`. The env Canvas token is used only with the env base URL and only for the demo student; profile URLs must be single-label `*.instructure.com`. `/api/magic-link` and `/open/:token` join the service-role allowed list. |
| 2026-11-14 | Web chat changes: (1) reply text has no URLs (prompt + server strip; the mock no longer appends the deep link); links stay SMS-only. (2) Web replies that cite notes pages are saved to new `saved_notes` (migration `20261114050000`, student select/insert/delete own, no update; composite FKs to `courses` and `chat_sessions`) and listed on `/notes` under their class, with `/notes/saved/<id>`. (3) Web agent gets `ask_clarifying_questions` (1-3 questions, options with single/multiple pick, optional typed answer); `/api/chat` streams new events `questions` and `saved_note`. (4) Stop button aborts the request; the server then saves no reply and no note. |
| 2026-11-14 | MCP demo features (Allen, 18:45; integration branch `agent/mcp-demo`, plan `orchestrations/plans/mcp-demo.md`): (1) MCP gets one write tool, `save_study_guide` (rules in "MCP contract"); defined in `contract.ts` apart from the seven read tools so the web/SMS agent never sees it. Migration range `20261114060000`-`20261114060959`: `saved_notes.source` (`chat` default, `mcp`), and `magic_links` may target a saved note (`saved_note_id`, composite FK to `saved_notes`, exactly one of file or saved note). `/open/:token` opens `/notes/saved/<id>` for those. The MCP route joins the service-role allowed list for the text step only. It also runs on the demo URL token (Allen chose this), capped at 10 saves per student per hour; rotate the token after the demo. (2) MCP prompts `study_guide`, `cram_plan`, `quiz_me`. (3) The crunch-week text ends "Want a plan? Reply YES."; a YES-style reply within 24 hours of the student's latest sent crunch alert is answered with a study plan for that week by the same agent and tools. |
| 2026-11-14 | Chat/notes QA decisions (Allen, after `orchestrations/reports/chat-e2e.md`): (1) Every finished web reply that cites notes pages is saved to Notes, including short topic answers; cut-off (`partial`) replies are not. (2) The `/api/chat` `citation` event gets an optional `title` (the file's title) so chat source chips read "<title> p.<n>", the same as on saved notes. (3) One real course counts as "no Canvas materials" (its materials are on Piazza); no Pages/Announcements scanner. (4) Canvas files sync ingests up to 100 PDFs per run (was 25). (5) Saved notes group label stays "Saved by chat or AI". Hosted migrations `20261114050000` and `20261114060000` applied 2026-11-14 with Allen's approval. |
| 2026-11-15 | Assignment attachments (Allen): Canvas keeps them only as file links inside the assignment description, so Canvas sync stores the description as plain text plus `canvas_url`, and each linked file as an `assignment_files` row (migration `20261115010000`, students select own only, all writes service role, private bucket `assignment-files` with path `<student_id>/<assignment_file_id>.<pdf|docx>`). PDF and Word (.docx) are downloaded and read into `assignment_file_pages`; other types are listed by name only. Kept apart from notes (Allen's choice): not on `/notes`, not in search_notes/get_recent_notes, not citable as notes pages. New read tool `get_assignment` (MCP and the web/SMS agent); `get_deadlines` gains `attachmentCount`. Web: `/assignments/<id>` shows instructions and attachments; `/assignments/<id>/files/<attachmentId>` shows a PDF in the viewer or a Word file's text; Deadlines links to it. Attachment download links from Canvas are capability URLs: never logged or returned. |
| 2026-11-15 | Judge previews (Allen): the login page shows a "Judge demo login" button when `JUDGE_STUDENT_EMAIL` and `JUDGE_STUDENT_PASSWORD` are set; a server action signs in to one shared judge account (`app_metadata.judge = true`, id `33333333-…`), created and reset by `npm run seed:judge` with the demo student's synthetic courses and PDFs (touches no other student; safe on hosted). Judges use the same Gemini models. The judge account has no SMS (Phone and SMS sim hidden and refused; link-code 403) and no Canvas linking (token POST 403), because judges share it. MCP for judges is OAuth through the same button. `PLUTO_AUTO_LOGIN_DEMO` is removed; production shows the normal login page. |
| 2026-11-15 | The judge login button is labeled "Preview" (Allen). Same server action and shared account as above. |
