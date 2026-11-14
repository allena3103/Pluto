# Pluto (HackUMass build, owner: Allen)

Goal: an AI academic manager. The demo moment is Claude building a study guide from live notes through the Pluto MCP server. Web chat and SMS answer from the same agent, the same tool functions and the same database.

Contract: `docs/plan.md` (human-readable) and `packages/core/src/contract.ts` (zod). They must agree. Process: `orchestrations/files/PROTOCOL.md`. Shared brief: `orchestrations/files/BRIEF.md`.

## Roles
- Director: plans, edits the contract, reruns checks on `agent/pluto` after every merge. Only the director edits `docs/plan.md`.
- Orchestrator: owns one slice, plans it, spawns coders (herdr tabs) and fresh reviewers for security PRs, reruns checks after each merge into its branch, opens one PR into `agent/pluto` per milestone.
- Coder: one task, one worktree, one branch. May use in-session subagents for independent parts, never two on the same file.
- Reviewer (security PRs only): fresh session, no history, follows `REVIEW.md`, never fixes anything.
- Grokbot: Allen's GitHub reviewer. Reviews, UI-tests and merges every PR. Agents never merge.

This project explicitly allows orchestrators to spawn their own agents; that overrides any global rule saying otherwise.

## Allen's global rules (every agent, Claude and Cursor)
Cursor does not load Allen's personal `~/.claude/CLAUDE.md`, so the parts that apply here are copied in:
- Replies: concise, lead with the answer, no filler or praise, plain words in full sentences, short lists only when they help.
- Never push to `main`, merge to `main`, deploy, or write to production unless Allen asks. Stop and report when you hit something that needs his decision.
- Approval prompts that grant access (MCP servers, new permissions) are Allen's. Pick the option that grants nothing, or report it. Exception: Claude's "trust this folder" prompt for `C:/Pluto-*` worktrees may be accepted.
- Don't trust a worker's report: read its diff and rerun lint, typecheck and build yourself. Read every migration in full before it's applied and check new objects can't leak data.
- Keep state in files (plans, reports, git), not only in your context.
- Close only tabs you created. Remove only worktrees whose branches are merged and that have no uncommitted or untracked files.

## Rules
- Stay inside the files your task owns (see your task file). Need a change elsewhere: ask your orchestrator; orchestrators ask the director.
- Contract change needed: stop and tell your orchestrator; it goes to the director, who edits `docs/plan.md` first, then code follows.
- MCP tools are read-only and scoped to the signed-in student. Every query filters by `student_id` explicitly AND runs with row-level security on. Never return another student's data.
- The service-role key is server-only and only in routes that must act without a user session (SMS webhook, ingest, alerts, Canvas sync, magic-link open). Those routes verify a secret or signature first.
- Page numbers are 1-based everywhere.
- Web: mobile first, every screen works at 390px width. Tailwind + shadcn/ui. Log in with Supabase Auth.
- SMS: inbound text, find the student by phone, call the agent, text the answer back. Sendblue sandbox: a person must text the number first, then Pluto can reply for 24 hours. Cold outbound is untested; do not rely on it. Webhook payload gives `from_number` and `content`.
- Canvas calls handle rate limits (429/403 with rate headers), pagination and empty responses. Seeded data must work without live sync.
- Secrets (Canvas tokens, Sendblue keys, Gemini key, service-role key) live in env vars only. Never commit `.env*` except `.env.example`. Never commit real course PDFs.
- Every external call (Canvas, Sendblue, Gemini, Supabase) has a timeout and handled errors.
- Without real keys, use the mocks: `PLUTO_LLM=mock`, `SMS_PROVIDER=simulator`, `CANVAS_MODE=fixtures`.
- Never run `supabase db reset` on the shared local stack; only the director may. Migrations are additive and use your assigned timestamp range.

## Process
1. State which build step and which contract items you touch.
2. Commit small and often; push your branch after every commit.
3. Before a PR: `npm run typecheck`, `npm run lint`, `npm test` pass. Paste the real output tails in the PR body.
4. Security PRs (see `PROTOCOL.md` section 4) get a fresh reviewer using `REVIEW.md` first; fix BLOCKING issues once, get one re-review, then escalate. Grokbot reviews and merges every PR once CI is green.
