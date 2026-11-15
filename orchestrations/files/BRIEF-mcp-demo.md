# Shared brief: MCP demo wave (Sat 2026-11-14 18:45 EST, freeze Sun 03:00)

Read `CLAUDE.md`, `docs/plan.md` (contract; the "MCP contract" section and the last decision-log row are new), `orchestrations/files/BRIEF.md` (security rules, stack) and your task file. Where this brief and `BRIEF.md` disagree, this brief wins for this wave.

## Goal
Make the MCP demo tighter and more surprising. Five ideas, in Allen's order:
1. Claude saves back to Pluto: MCP write tool `save_study_guide`; the guide lands in Notes and Pluto texts a magic link to it.
2. MCP prompts `study_guide`, `cram_plan`, `quiz_me`, so they show as one-click options in Claude.
3. One server, every AI: the same URL in Claude, ChatGPT and Cursor; the Connect AI page (`/mcp`) makes it copy-and-paste.
4. Quiz with citations: a rehearsed prompt (and the `quiz_me` prompt) where every answer links to the exact page.
5. Proactive hook: the crunch-week text asks "Want a plan? Reply YES."; replying YES gets a plan built from the same tools.

## Allen's priorities (in order)
1. The existing demo path never breaks: the 7 read tools, the study guide with page citations, OAuth and the demo URL-token route keep working.
2. Nothing leaks across students. The write tool writes only for the authenticated student, and only texts that student's own linked phone.
3. Every surface calls `packages/core`; no second implementation of a tool.
4. Polish last.

## Branches, ports, migrations
Integration branch `agent/mcp-demo`, worktree `C:/Pluto-mcp-demo`, owned by the director. Each worker branches from it and opens one PR into it.

| Worker | Ideas | Branch / worktree | Port | Reviewer port | Migrations | Security review |
| --- | --- | --- | --- | --- | --- | --- |
| mcp-save | 1 | `agent/mcp-save` / `C:/Pluto-mcp-save` | 3601 | 3611 | `20261114060000`-`20261114060959` | yes |
| mcp-prompts | 2, 4 | `agent/mcp-prompts` / `C:/Pluto-mcp-prompts` | 3602 | 3612 | none | no |
| crunch-plan | 5 | `agent/crunch-plan` / `C:/Pluto-crunch-plan` | 3603 | 3613 | none | yes |
| every-ai | 3, 4 | `agent/every-ai` / `C:/Pluto-every-ai` | 3604 | 3614 | none | no |

Stay inside the files your task file lists. Need anything else: stop, describe it in your reply, and go idle. Contract questions go to the director; `docs/plan.md` and `packages/core/src/contract.ts` win over your task file.

Open PRs on `main` you must not collide with: #58 `agent/chat-clarify` (edits `packages/agent/src/mock.ts`, `gemini.ts`, `test/agent.test.ts`) and #55 `agent/canvas-live` (`proxy.ts`, `scripts/env-local.mjs`, canvas settings form).

## Review and merge
Every PR in this wave gets a fresh reviewer agent (opus, visible herdr tab, `REVIEW.md`, your task file as goals, the diff as `.review/diff.patch`). It runs in your worktree after you go idle, so stay idle once you reply DONE. One fix round, one re-review. The director reads the diff, reruns typecheck, lint, test and build, and merges into `agent/mcp-demo`. You never merge, never push to `agent/mcp-demo` or `main`, never deploy.

## Security rules (on top of `BRIEF.md`)
- `student_id` always comes from the verified auth result (MCP token, session, phone lookup after the webhook secret), never from tool input, prompt arguments or message text.
- Every query filters by `student_id` explicitly, even with the service role.
- The service-role client is created only after auth succeeds, and only where `CLAUDE.md` allows it.
- Errors returned to a client or a text never contain Postgres, Supabase, Sendblue or Gemini error text. Log the code server-side; in MCP URL-token mode log only codes and `error.name`.
- No secrets, tokens, magic-link tokens or phone numbers in logs.

## Production rules (from `CLAUDE.md`)
Every external call (Supabase, Sendblue, Gemini) has a timeout and handled errors. Page numbers are 1-based. Web screens work at 390px. Secrets only in env vars; never commit `.env*` except `.env.example`.

## Testing without real keys
- `npm install`, then `npm run env:local -- --port <your port>`. It writes `apps/web/.env.local` from the shared local Supabase stack (Docker, already running) with `PLUTO_LLM=mock`, `SMS_PROVIDER=simulator`, `CANVAS_MODE=fixtures`. For local MCP calls, append `PLUTO_DEMO_MCP_TOKEN=<any 32+ chars>` (and `PLUTO_DEMO_MCP_URL_ENABLED=1` to test the URL route) to `apps/web/.env.local`; never commit it.
- Shared Supabase stack: never `supabase db reset`, never stop it. Only `mcp-save` applies a migration (`npx supabase migration up`). Tests create their own users with unique emails and clean up.
- Seed: demo student `demo@pluto.test` (id `11111111-1111-4111-8111-111111111111`, phone `+15555550100`) and `other@pluto.test`; passwords in `.env.example`. Simulated texts show at `/sms-sim` and in `sms_messages`.
- 16 GB machine shared by several agents. Never run a server in the foreground and never leave one running: `npm run build -w @pluto/web`, start it in the background on your port, curl it, stop it. One dev/start server per worktree.

## Delivery
Commit small, push after every commit. Before the PR: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build -w @pluto/web` pass. `gh pr create --base agent/mcp-demo --head agent/<name>`; add `--label security-review` if your row says yes. The PR body is your report:
1. What is done, mapped to each acceptance check in your task file.
2. Contract items touched.
3. Real output tails of typecheck, lint, test, build, and of every manual check (commands and what you saw).
4. Open issues, risks, decisions needed.
5. How to UI-test it (URLs, login, clicks, expected result).

Then reply `DONE <PR URL>` and go idle.
