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

Nine groups of data, and every row belongs to one student with row-level security on, so a student only ever sees their own rows.

| Table | Holds | Main fields |
| --- | --- | --- |
| profiles | One row per student | name, phone number for SMS, encrypted Canvas token |
| courses | A student's courses | name, term, Canvas course id |
| assignments | Deliverables | course, title, due date, previous due date, date-changed time, points, weight group, score, graded or not |
| grade\_groups | Weighting rules | course, group name (homework, exams), weight percent |
| files | Lecture PDFs and syllabi | course, title, week label, added date, source (Canvas or manual), storage path, ingest status |
| file\_pages | Searchable text | file, page number, page text, search index |
| chat\_sessions and chat\_messages | Web and SMS conversations | session, role, text, cited file and page, channel |
| magic\_links | One-time links sent by SMS | token, student, target file and page, expiry |
| alerts | Proactive alerts | student, kind (crunch week or date change), week or assignment, message, sent time, calendar feed token |

## MCP contract

Seven read-only tools, so a wrong tool call from Claude can never change student data.

| Tool | Inputs | Returns |
| --- | --- | --- |
| list\_courses | none | course id, name, term |
| get\_recent\_notes | course (name or id), days (default 14) | every file added in the window: title, week label, date, page text in order, a truncated flag, deep link |
| get\_note\_pages | file id, optional first and last page | text of those pages with page numbers |
| search\_notes | query, optional course, limit | matching pages: file, page, short snippet, deep link |
| get\_deadlines | optional course, days ahead (default 30) | title, due date, previous due date if it moved, points, weight group, status |
| get\_grades | optional course | score and weight per group, running weighted grade, count of ungraded items |
| get\_crunch\_weeks | weeks ahead (default 8) | weeks ranked by number and weight of deliverables due (stretch; also feeds the SMS alert) |

- **Auth:** the student signs in with their Pluto account through OAuth; every call is scoped to that student.
- **Size rule:** get\_recent\_notes stops at a fixed text cap and sets the truncated flag; Claude then calls get\_note\_pages for the rest.
- **Citations:** every result carries a deep link to the exact page in the web app, so the study guide can cite pages.
- **Changes:** a tool name or field changes here first, then in code.

* **Client support:** standard remote MCP over streamable HTTP at `/api/mcp` with OAuth, so Claude and ChatGPT connect to the same server. Test ChatGPT at build step 4; the live demo runs in Claude.

## Internal API contract

Ten endpoints connect the web app, the agent and the integrations; settle each one's field-level shapes before building it.

| Endpoint | Called by | In | Out |
| --- | --- | --- | --- |
| /api/ingest | Canvas sync, manual import | file id | status; fills file\_pages |
| /api/chat | web chat view | session id, message | streamed reply with cited file and page |
| /api/agent/reply | SMS webhook | student id, text, channel | reply text and optional deep link |
| /api/grades | web grade view | optional course | same data as get\_grades |
| /api/magic-link | the agent, internally | student id, file id, page | one-time URL |
| /open/:token | a phone tapping the link | token | signs the student in, opens the PDF at the page |
| /api/sms/inbound | Sendblue | incoming message | finds the student by phone, calls agent/reply, texts the answer |
| /api/alerts/demo | the demo button | student id | sends the crunch-week SMS with a calendar link |
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

Every change is written by one coder agent and checked by a fresh reviewer agent that has never seen the work, with two review rounds at most. Full process: `orchestrations/files/PROTOCOL.md`.

1. **Coder agent.** One session per task in its own worktree and herdr tab, given CLAUDE.md, this contract and that one task.
2. **Self-check.** Before a pull request, typecheck, lint and tests pass, and the coder lists which contract items it touched.
3. **Reviewer agent.** A fresh headless session gets only the project goals, the contract and the diff, using REVIEW.md. It runs the checks and reports BLOCKING or NON-BLOCKING. It does not fix anything.
4. **Blocking means** a bug, a contract mismatch, a missing auth or row-level-security check, or a secret in code. Style and naming never block.
5. **Limit.** One fix round and one re-review. Still open: the orchestrator decides non-security items; security and contract items go to the director, then Allen.
6. **Merge.** Coder PRs merge into the orchestrator branch (orchestrator merges). Orchestrator PRs merge into `agent/pluto` (director merges after grokbot review and re-running checks). `agent/pluto` into `main`: director opens the PR, Allen merges.
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
