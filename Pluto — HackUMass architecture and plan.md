# Pluto — HackUMass architecture and plan

Nov 12, 2026 · @Allen

Planning only, no code: build a Canvas-fed note search and a Claude MCP server so a student can say "make me a study guide from my last 2 weeks of notes" and get it live.

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
| Auth and database | Supabase Auth, Postgres, Storage | In your plan already; Postgres holds courses, grades and page text, Storage holds the PDFs |
| Note search | Postgres full-text search, one row per PDF page | Fastest to build and no extra service; add vector search only if time remains |
| PDF handling | Per-page text extraction on upload; pdf.js viewer that opens to a page number | Page-level answers are the feature |
| Agent | Claude API with tool use, one agent loop shared by web chat and SMS | Same tools as the MCP, so every surface behaves alike |
| MCP server | TypeScript MCP SDK over HTTP with OAuth, deployed as its own small service | Claude connects as a custom connector; each student sees only their own data |
| SMS | Sendblue free sandbox (iMessage/SMS, no approval needed); Twilio Virtual Phone or a dashboard SMS simulator as fallback | Twilio toll-free verification needs review time, so it will not clear before kickoff. Sandbox limits: 10 verified contacts, and each person must text the number first; Pluto can then reply for 24 hours |
| Calendar | ICS feed link per student | Works with Apple and Google Calendar with no calendar OAuth |
| Repo and CI | One GitHub repo, typecheck and lint on every push | Catches breakage early when one person builds everything |

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

* **Client support:** standard remote MCP over HTTP with OAuth, so Claude and ChatGPT connect to the same server. Test ChatGPT at build step 4; the live demo runs in Claude.

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

Allen builds alone, one step at a time, in this order; the demo path comes first, so if time runs short, cut from the bottom.

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

Every change is written by one agent and checked by a second agent that has never seen the work, with two review rounds at most.

1. **Writer agent.** One Claude session per build step, given CLAUDE.md, the contracts in this doc and that one step. It may spawn subagents for independent parts, never two on the same file.
2. **Self-check.** Before a pull request, typecheck and lint pass, and the writer lists which contract items it touched.
3. **Reviewer agent.** A fresh session with no history gets only the project goals, the contract and the diff. It runs typecheck and the smoke script, then reports problems as blocking or non-blocking. It does not fix anything.
4. **Blocking means** a bug, a contract mismatch, a missing auth or row-level-security check, or a secret in code. Style and naming never block.
5. **Limit.** One fix round and one re-review. Anything still open, Allen decides.
6. **Merge.** Allen skims the diff, then merges to main. Commit small and often; commit history is part of the record.
7. **Contract changes.** An agent never edits the contract on its own: this doc changes first, then the code.

Before kickoff, confirm that the event allows AI-assisted coding; this plan assumes it does.

## Agent instructions

Paste the first block into the repo root as CLAUDE.md and the reviewer prompt as REVIEW.md. These are instructions for the agents, not project code.

**CLAUDE.md, for every writer agent**

```markdown
# Pluto (solo build, owner: Allen)

Goal: an AI academic manager. The demo moment is Claude building a study guide from live notes through the Pluto MCP server. Web chat and SMS answer from the same agent and the same database.

How to work
- Follow the build order in the planning doc. Do one step per session and do not start the next until its done-when check passes.
- If a decision is open, ask Allen in one short round of numbered questions. Never assume an answer.
- You may spawn subagents for independent parts of a step. Give each one task and its own files, never let two edit the same file, and check the combined result.

Rules
- The contract (MCP tools and internal API) in the planning doc is the source of truth. If it must change, stop and tell Allen so the doc changes first.
- MCP tools are read-only and scoped to the signed-in student. Every query is filtered by student, with row-level security on. Never show another student's data.
- Page numbers are 1-based everywhere.
- Web: mobile first, every screen must work at phone width. Log in with Supabase Auth.
- SMS: inbound text, find the student by phone, call /api/agent/reply, text the answer back. Sendblue sandbox: a person must text the sandbox number first, then Pluto can reply freely for 24 hours (each new text resets the window). Cold outbound is untested, so do not rely on it. The webhook payload gives from_number and content. The crunch alert is a demo button that sends one scripted message with a calendar link while the demo phone's window is open.
- Canvas calls must handle rate limits and empty responses. Seeded data must work without live sync.
- Canvas tokens, Sendblue keys and API keys are secrets: environment variables only, never committed. Do not commit course PDFs.

Process
1. State which build step and which contract items you touch.
2. Run typecheck and lint before opening a pull request.
3. A separate fresh reviewer agent reviews every diff using REVIEW.md. Fix blocking issues once, get one re-review, then ask Allen.
```

**REVIEW.md, the fresh reviewer's prompt**

```markdown
# REVIEW.md: prompt for the fresh reviewer agent

You are reviewing a diff with no knowledge of how it was written. You are given the project goals, the contract and the diff.

1. Run typecheck, lint and the smoke script. Report the results first.
2. Check the diff against the contract: tool names, inputs, outputs, endpoint paths.
3. Check every external call (Canvas, Sendblue, Supabase, Claude API) for error handling and timeouts.
4. Check for secrets in code, missing auth or row-level-security checks, and data returned for the wrong student.
5. Check that page numbers are 1-based and deep links open the right page.

Report each problem as BLOCKING (bug, contract break, security) or NON-BLOCKING (style, naming). Do not fix anything, and never block on style.
```

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
