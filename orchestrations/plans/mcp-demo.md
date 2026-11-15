# Director plan: MCP demo wave (Sat 2026-11-14 18:45 EST, freeze Sun 03:00)

Allen asked for all five MCP-demo ideas, built on separate branches by workers, with a separate reviewer agent. Shared brief: `orchestrations/files/BRIEF-mcp-demo.md`. Contract: `docs/plan.md` (decision-log row "MCP demo features").

## Allen's decisions (18:45)
1. The save text carries a magic link that signs the phone in and opens the saved guide (migration + `/open` change).
2. `save_study_guide` also runs on the demo URL-token route, capped at 10 saves per student per hour.
3. The director merges worker PRs into `agent/mcp-demo` after a fresh review approves and the checks pass; then one PR `agent/mcp-demo` -> `main` for Allen.

## Workers
| Order | Worker | Model | Ideas | Depends on | Security review |
| --- | --- | --- | --- | --- | --- |
| 1 | mcp-save | opus | 1 | - | yes |
| 1 | mcp-prompts | sonnet | 2, 4 | - | no (fresh review anyway) |
| 2 | crunch-plan | sonnet | 5 | a free slot | yes |
| 3 | every-ai | sonnet | 3, 4 | mcp-save and mcp-prompts merged | no (fresh review anyway) |

At most 2 coders at once (16 GB machine; check free memory before each spawn, wait under 2 GB). One reviewer at a time.

## Review loop (every PR)
1. Worker replies `DONE <PR>` and goes idle.
2. Director reads the diff (every migration in full; auth, service-role and SMS code line by line).
3. Fresh reviewer `rv-<worker>` (opus, visible tab, in the worker's worktree, reviewer port = worker port + 10): `REVIEW.md`, task file as goals, `.review/diff.patch` (base `agent/mcp-demo`). Report to `.review/review-1.md`, posted on the PR.
4. CHANGES REQUIRED: worker gets the review path, one fix round, one fresh re-review. Still blocking: escalate to Allen.
5. APPROVE: director reruns typecheck, lint, test, build on the PR head, merges into `agent/mcp-demo` (merge commit), reruns the checks on `agent/mcp-demo`, closes the worker and reviewer tabs.

## Finish
After all four merge: full checks + `npm run smoke` on `agent/mcp-demo`, one live pass of the demo path on a local build, then `gh pr create --base main --head agent/mcp-demo`. Allen merges and deploys; the hosted DB needs migration `20261114060000`.
