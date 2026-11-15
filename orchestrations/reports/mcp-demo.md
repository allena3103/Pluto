# Report: MCP demo wave (`agent/mcp-demo`, Sat 2026-11-14 19:55 EST)

## 1. Done
| Idea | What shipped | PR |
| --- | --- | --- |
| 1. Claude saves back | MCP write tool `save_study_guide`: saves a `saved_notes` row (`source = 'mcp'`), keeps only the student's own cited pages, files it under the class, texts a one-time magic link that signs the phone in and opens `/notes/saved/<id>`. 10 saves per student per hour. Works on OAuth, demo bearer and demo URL token. | #60 |
| 2. MCP prompts | `study_guide` (ends by saving with `save_study_guide`), `cram_plan`, `quiz_me` | #59 |
| 3. One server, every AI | `/mcp` lists 8 tools with an accurate access line, a one-click prompts card, updated Claude/ChatGPT/Cursor steps; "From Claude" chip on MCP-saved notes | #62 |
| 4. Quiz with citations | `quiz_me` prompt + a verbatim rehearsed prompt in `docs/demo-mcp.md` and on `/mcp` | #59, #62 |
| 5. Proactive hook | Crunch text ends "Want a plan? Reply YES."; a YES-style reply within 24 h of a sent crunch alert gets a plan for that week from the same agent and tools (mock path deterministic) | #61 |

Stage runbook: `docs/demo-mcp.md`.

## 2. Contract items touched
`docs/plan.md`: MCP contract (write tool row + rules, prompts table, client support), data model rows `saved_notes` and `magic_links`, endpoint rows `/open/:token`, `/api/sms/inbound`, `/api/alerts/demo`, decision-log row "MCP demo features". `CLAUDE.md` and `BRIEF.md` security rules (write-tool exception, service role in the save text step, magic-link targets). `contract.ts`: `WRITE_TOOLS` (`save_study_guide`), `OPEN_RESPONSE.savedNoteLocation`. Migration `20261114060000_mcp_saved_notes.sql`.

## 3. Checks on `agent/mcp-demo` (after all four merges and `origin/main` with #58)
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0, 2 warnings (`settings/phone/phone-link.tsx` pre-existing; unused `_input` in `apps/web/lib/crunch-plan.test.ts`).
- `npm test`: exit 0. web 21 files / 207 tests, agent 2 / 33, canvas 12 / 72, core 18 / 188, mcp 12 / 75.
- `npm run smoke`: `PASS 00-core.ts`, `smoke: 1/1 files passed`.
- `npm run build -w @pluto/web`: exit 0.
- Live on a local build (:3600, `PLUTO_LLM=mock`, `SMS_PROVIDER=simulator`):
  - `initialize` advertises tools + prompts on `/api/mcp` (bearer) and `/api/mcp/demo/<token>`; 8 tools, `save_study_guide` the only non-read-only one; 3 prompts; no auth 401.
  - `save_study_guide` over the URL token: `{"courseName":"History 105","citedPages":2,"textStatus":"sent"}`; text `Pluto: your study guide "History 105 study guide (smoke)" is saved. Open it: .../open/<token>`; `/open` #1 302 `/notes/saved/<id>` with a session cookie, #2 302 `/login?error=link`; saved page 200; "From Claude" chip on `/notes` and the saved page; `/mcp` shows the write tool and the prompts card.
  - Crunch alert 200 `sent: true`, text ends "Want a plan? Reply YES."; webhook `Yes!` 200; reply is a 4-day plan for Nov 30-Dec 6 with a magic link.

## 4. Reviews
Fresh opus reviewer per PR (`REVIEW.md`, task file as goals, diff only), reports posted on each PR.
- #59 mcp-prompts: APPROVE. Non-blocking item 1 (cram plan `daysAhead`) fixed before merge.
- #60 mcp-save (security): APPROVE. Migration read in full by the reviewer and me; probes show no cross-student path (composite FK rejects a link to another student's note; students have no `magic_links` access).
- #61 crunch-plan (security): APPROVE.
- #62 every-ai: CHANGES REQUIRED (runbook fallback claimed texts show in `/sms-sim` on Sendblue; they don't). Fixed in one round; fresh re-review APPROVE.
- Director fixes on the integration branch: `study_guide` prompt names the `markdown` field; mock agent checks the server-built plan request before #58's class-notes path.

## 5. Open issues and decisions for Allen
- **Apply migration `20261114060000` on the hosted DB before (or with) this deploy.** The new code selects `magic_links.saved_note_id` and `saved_notes.source`; without the migration every `/open` link and the Notes page fail.
- Live client checks need your accounts: Claude (custom connector), ChatGPT (developer mode), Cursor. Whether Cursor lists MCP prompts under `/` is unverified; rehearse it.
- `PLUTO_DEMO_MCP_URL_ENABLED=1` now also allows writes (your choice). Rotate `PLUTO_DEMO_MCP_TOKEN` after the demo.
- Rate limit is count-then-insert: parallel calls can pass 10, and a student can delete own notes to save again. Own data only; fine for the demo.
- With Gemini, the SMS system prompt caps replies at 300 characters, so a busy week's plan gets compressed.
- The chip says "From Claude" for any MCP client's save.
- `/mcp` changes were checked as server HTML, not in a 390px browser.

## 6. How to UI-test
1. `npm run env:local`, add `PLUTO_DEMO_MCP_TOKEN=<24+ chars>` and `PLUTO_DEMO_MCP_URL_ENABLED=1` to `apps/web/.env.local`, `npx supabase migration up`, build, start.
2. Sign in as `demo@pluto.test`; open `/mcp`: 8 tools, "One-click prompts" card, write-tool line.
3. Connect Claude (or Inspector) to `/api/mcp/demo/<token>`; run the "Study guide" prompt for History 105. Expect the guide, a `save_study_guide` call, a text in `/sms-sim` with an `/open/` link that opens the guide with a "From Claude" chip.
4. `/sms-sim`: press "Crunch week alert" (text ends "Want a plan? Reply YES."), send `YES`; expect a day-by-day plan for that week.
