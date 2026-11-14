# Foundation orchestrator handoff (written 2026-11-14 ~01:00 EST, in case the Claude meter runs out)

State
- F1 milestone PR #9 (`agent/foundation` -> `agent/pluto`) is open; grokbot asked for fixes; the director's Cursor coder `foundation-harden` (tab `foundation-harden`, branch `agent/foundation-harden`) is doing them. When it merges into `agent/foundation`: pull, rerun typecheck/lint/test/smoke/build, run a fresh Cursor review (it touches migrations and proxy, so label `security-review`), post the verdict on PR #9 and update the PR #9 body and `orchestrations/reports/foundation-F1.md`.
- Merged into `agent/foundation`: #1 contract, #2 db, #3 shell, #4 tools.
- PR #10 helpers: open, labeled `security-review`, CI green. Fresh Cursor review running from `C:/Pluto-foundation-helpers` -> `.review/review-1.md`. Post it with `gh pr comment 10 --body-file`. CHANGES REQUIRED: one fix round via tab `foundation-helpers` (Cursor needs `herdr agent send-keys <name> enter` after `herdr agent prompt`), then one re-review.
- `foundation-ingest`: NOT started (memory under 2 GB). Brief is `orchestrations/tasks/foundation-ingest.md` (includes the hardening rules). Spawn on Cursor per PROTOCOL 2/2b when free memory is 2 GB or more and fewer than 2 coders run. Its PR needs `security-review` + fresh review.

Left for F2 after helpers and ingest merge
1. `scripts/smoke/00-core.ts` (default-export async function): as demo student call all 7 `TOOL_HANDLERS`, assert a `seed/pdfs/manifest.json` query returns the expected file and page, assert `other@pluto.test` sees nothing of the demo student, assert `getRecentNotes` sets `truncated` with a small cap.
2. `packages/core/src/index.ts` re-exports (contract, deep-links, context, tools, magic-links, sms, ics, ingest).
3. `orchestrations/reports/foundation-F2.md` and milestone PR into `agent/pluto` (after #9 merges, or as an update of the same branch).

Notes
- Shared Supabase stack runs from `C:/Pluto-foundation` (never reset/stop). Migration `20261113000500` (harden) must be applied with `npx supabase migration up` after it merges.
- Reviewer command: PowerShell, `cursor-agent.cmd -p --force --trust --model gpt-5.3-codex "<prompt>"` from the coder worktree; reviewers one at a time.
- Tabs created by this orchestrator still open: `foundation-helpers` (wF:t8). Worktrees to remove later when clean and merged: `C:/Pluto-foundation-{db,contract,shell,tools}`.
