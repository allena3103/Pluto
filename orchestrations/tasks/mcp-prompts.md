# Coder task: mcp-prompts (Claude, sonnet): ideas 2 and 4, MCP prompts

Branch `agent/mcp-prompts`, worktree `C:/Pluto-mcp-prompts`, based on `agent/mcp-demo`, PR into `agent/mcp-demo`. Port 3602. No migrations. Not security-sensitive. Shared brief: `orchestrations/files/BRIEF-mcp-demo.md`.

## Demo this enables
In Claude, the Pluto connector offers "Study guide", "Cram plan for my busiest week" and "Quiz me" as one-click prompts. Picking "Quiz me" with course History 105 gives a practice quiz where every answer links to the exact notes page. Nothing to type on stage, so nothing to fumble.

## Contract (read first; it wins over this file)
`docs/plan.md`, "MCP contract": the "Prompts" table. Tool names and fields in `packages/core/src/contract.ts`.

## Files you own
- `packages/mcp/src/prompts.ts` (new): prompt definitions, argument validation, rendering. Export the list (name, title, description, arguments) so the web Connect AI page can import it as `@pluto/mcp/prompts` (the package already exports `./*`). Keep it free of server-only imports so a page can import it.
- `packages/mcp/src/server.ts`: only add `prompts: {}` to `capabilities` and register `ListPromptsRequestSchema` and `GetPromptRequestSchema` handlers that call into `prompts.ts`. Worker `mcp-save` edits the tool handlers in the same file at the same time; keep your edit to a few lines so the merge is trivial.
- `packages/mcp/test/prompts.unit.test.ts` (new) and one handler-level test file of your own (for example `packages/mcp/test/prompts-handler.unit.test.ts`).

Not yours: tool handlers, `descriptions.ts`, `apps/web/**`, `packages/core/**`.

## Build
- Three prompts, with `name`, `title` and `description`:
  - `study_guide` ("Study guide"): `course` (required), `days` (optional, default 14).
  - `cram_plan` ("Cram plan for my busiest week"): `weeks` (optional, default 8).
  - `quiz_me` ("Quiz me"): `course` (required), `topic` (optional), `count` (optional, default 8).
- MCP prompt arguments arrive as strings. Validate: `course` and `topic` trimmed, 1-200 chars; `days` integer 1-120; `weeks` integer 1-26; `count` integer 1-20. Missing required or invalid values, or an unknown prompt name: an MCP `InvalidParams` error with a plain message. The arguments are only text placed into the prompt; they are never used in a query.
- `prompts/get` returns one user message with the rendered text. The texts must make a good result likely on the first try:
  - All: use Pluto's tools, never invent page text, cite every fact as a markdown link `[p. N](deepLink)` using the `deepLink` the tools return, pages are 1-based.
  - `study_guide`: `get_recent_notes` for the course and days; if `truncated`, `get_note_pages` for the rest. Structure: key ideas, key terms, timeline or process where it fits, likely exam questions. Then save it with `save_study_guide` (title like "History 105 study guide", the full guide as the body with the links kept, the course) and tell the student it was saved and texted. (The tool lands from worker `mcp-save` on the same integration branch.)
  - `cram_plan`: `get_crunch_weeks` with `weeksAhead`, take rank 1; `get_deadlines` for what is due that week; `search_notes` for each deliverable's topic; a day-by-day plan from today to the last due date with 60-90 minute blocks, heaviest-weight items first, each block linking to the notes pages it needs.
  - `quiz_me`: notes from `get_recent_notes` (or `search_notes` when a topic is given); `count` questions mixing multiple choice and short answer, numbered; an "Answers" section at the end only, each answer with a one-line explanation and the page link it comes from.
- Server instructions and tool descriptions stay as they are (worker `mcp-save` owns them).

## Acceptance checks (prove each in the PR body)
- Unit: `prompts/list` returns the three prompts with their arguments and `required` flags; `prompts/get` renders the course, topic and numbers given, and the defaults when omitted; bad arguments and unknown names give `InvalidParams`.
- Through the real HTTP handler with the demo bearer (no DB needed for prompts, but auth must still run first): `initialize` advertises `prompts`; `prompts/list` and `prompts/get` work; with no token you still get 401.
- Live: build, start on 3602 in the background with `PLUTO_DEMO_MCP_TOKEN` set, then `npx @modelcontextprotocol/inspector --cli http://localhost:3602/api/mcp --transport http --header "Authorization: Bearer <token>" --method prompts/list` (and `prompts/get --prompt-name quiz_me --prompt-args course="History 105"`). Paste the output. If the inspector CLI fails on Windows, use curl JSON-RPC and say so. Stop the server.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build -w @pluto/web` pass.
