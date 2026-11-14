# Coder task: every-ai (Claude, sonnet): ideas 3 and 4, one server for every AI + demo runbook

Branch `agent/every-ai`, worktree `C:/Pluto-every-ai`, based on `agent/mcp-demo` after `mcp-prompts` and `mcp-save` merged into it, PR into `agent/mcp-demo`. Port 3604. No migrations. Not security-sensitive. Shared brief: `orchestrations/files/BRIEF-mcp-demo.md`.

## Demo this enables
On stage: open `/mcp` (Connect AI), copy one URL, and show Pluto connected in Claude, ChatGPT and Cursor side by side; then a rehearsed "quiz me with citations" prompt whose answers link to exact pages; then the save-back loop and the crunch text. Allen runs the live clients; you make the page right and write the runbook he rehearses from.

## Contract (read first)
`docs/plan.md`, "MCP contract" (8 tools, write-tool rules, prompts, client support). `packages/core/src/contract.ts` (`TOOLS` and the separate write-tool map), `packages/mcp/src/prompts.ts`.

## Files you own
- `apps/web/lib/mcp-connect.ts`, `apps/web/components/mcp/**`, `apps/web/app/(app)/mcp/**` and their tests.
- `apps/web/app/(app)/notes/**` and `apps/web/components/notes/**`: only a small "From Claude" chip for saved notes with `source = 'mcp'` on the Notes list and on `/notes/saved/<id>`.
- `docs/demo-mcp.md` (new): the stage runbook.

Not yours: `packages/**`, API routes, migrations.

## Build
1. **Connect AI page (`/mcp`)**
   - "What your AI can do": the 7 read tools plus `save_study_guide`, typed from the contract so a new tool cannot be left out. Replace "All 7 tools are read-only. Your AI cannot change anything in Pluto." with an accurate line: it reads your data, and the one write tool only saves a study guide to your Notes and texts you a link; it cannot edit or delete anything. Fix the same claim in `agentHandoff` text and the server URL card.
   - New "One-click prompts" card: the three MCP prompts imported from `@pluto/mcp/prompts` (title, what it does, arguments), plus where to find them: Claude, the + menu then Pluto; Cursor, type `/` in chat; ChatGPT has no MCP prompts, so copy the matching example prompt instead.
   - `EXAMPLE_PROMPTS`: keep the History 105 study guide line; add "...and save it to Pluto" for the save loop, and a quiz-with-citations line (for example "Quiz me on my History 105 notes with 8 questions. Put the answers at the end, each linking to the exact page. Use Pluto.").
   - Keep the per-client tabs; check the Claude, ChatGPT and Cursor steps still match those apps' current UI (web search; cite what you checked in the PR body) and fix them if they don't. Everything works at 390px.
2. **"From Claude" chip** for `source = 'mcp'` saved notes (list and detail), reusing the existing badge component.
3. **Verify the server for each client you can reach without Allen's accounts.** Build and start on 3604 in the background with `PLUTO_DEMO_MCP_TOKEN` (and `PLUTO_DEMO_MCP_URL_ENABLED=1`). With the MCP Inspector CLI (`npx @modelcontextprotocol/inspector --cli ...`), over both `/api/mcp` (bearer header) and `/api/mcp/demo/<token>`: `tools/list` (8), `prompts/list` (3), `prompts/get quiz_me`, `tools/call list_courses`, `tools/call search_notes`. Check `/.well-known/oauth-protected-resource/api/mcp` answers. Do not connect Cursor, ChatGPT or Claude yourself and never approve an MCP server prompt: those are Allen's.
4. **`docs/demo-mcp.md`**, short and stage-ready:
   - Pre-flight checklist: hosted env (`APP_URL`, `PLUTO_DEMO_MCP_TOKEN`, `PLUTO_DEMO_MCP_URL_ENABLED=1` only for the demo, `SMS_PROVIDER=sendblue`), the new migration applied on the hosted DB, demo phone linked, Sendblue 24-hour window opened by texting the number first, Claude / ChatGPT / Cursor each connected and `list_courses` tried once, backup recording.
   - Connect steps per client (Claude custom connector, ChatGPT developer mode connector, Cursor "Add to Cursor" or `mcp.json`), OAuth first and the URL-token fallback.
   - A 30-90 second script per idea, with the exact words to type or the prompt to click and what the audience should see: (1) save back + text, (2) one-click prompts, (3) same URL in three AIs, (4) quiz with citations (rehearsed prompt verbatim, then tap an answer link to open the page), (5) crunch text -> reply YES -> plan.
   - Fallbacks: OAuth fails -> URL token; ChatGPT fails -> recording; texts fail -> `/sms-sim`.
   - After the demo: rotate `PLUTO_DEMO_MCP_TOKEN`, set `PLUTO_DEMO_MCP_URL_ENABLED` off.

## Acceptance checks (prove each in the PR body)
- `/mcp` at 390px and desktop: 8 tools listed, accurate write-tool line, the prompts card, the new example prompts (screenshot or the rendered HTML snippets you checked).
- A saved note created through `save_study_guide` shows the "From Claude" chip on `/notes` and its page; a chat-saved note does not.
- Inspector CLI output for every call in step 3, on both URL forms.
- `docs/demo-mcp.md` exists and every command, URL and env name in it matches the code.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build -w @pluto/web` pass.
