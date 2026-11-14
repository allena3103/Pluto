# Foundation orchestrator handoff

Written 2026-11-14 about 07:50. Replaces the earlier handoff. Read `CLAUDE.md`, `orchestrations/files/PROTOCOL.md` and `orchestrations/files/00-foundation.md` first.

## Where things stand
- Orchestrator worktree `C:/Pluto-foundation`, branch `agent/foundation`, pushed, clean. `origin/agent/pluto` (c6ee3a5) is merged in.
- F1 is merged into `agent/pluto` (PR #9).
- On `agent/foundation` and not yet on `agent/pluto`: PR #10 helpers (magic links, sms, ics).
- Cursor is on Allen's second account: only `composer-2.5`, `auto` and Grok models work.
- Next foundation migration number: `20261113000600`.
- Memory is very tight (about 0.8 GB free). Rule: at most 2 coders, one reviewer at a time, no dev servers left running, check free memory before spawning:
  `powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB"`

## 1. PR #25 ingest (first priority)
- https://github.com/allena3103/Pluto/pull/25, `agent/foundation-ingest` into `agent/foundation`, worktree `C:/Pluto-foundation-ingest`, label `security-review`, CI green. Built by the orchestrator; the orchestrator is its coder for any fix round.
- Fresh review: started about 07:35 as a background process with `grok-4.7-high`. No verdict yet at the time of writing. Two earlier runs died (Codex allowance, then low memory).
- Check: `C:/Pluto-foundation-ingest/.review/review-1.md`. If it exists, the review finished. If it does not and no `cursor-agent` process is running, rerun from PowerShell in `C:\Pluto-foundation-ingest`:
  ```
  $p = 'You are a fresh reviewer. Follow REVIEW.md exactly. This is a security review (service-role route guarded by INTERNAL_API_SECRET, PDF ingest, seed). Goals and acceptance checks: orchestrations/tasks/foundation-ingest.md, including its last section "Hardening rules". Diff: .review/diff.patch (base agent/foundation; package-lock.json and the binary PDFs are left out of the patch). A shared local Supabase stack is running: never run supabase db reset or supabase stop. apps/web/.env.local already exists (port 3004). Memory is very tight on this machine: do not start a dev server or a build; read the code and at most run npm test once. Do not fix anything. Write your report to .review/review-1.md and print it.'
  & cursor-agent.cmd -p --force --trust --model grok-4.7-high $p *> .review\review-1.log
  ```
  (`cursor-agent` runs only from cmd or PowerShell, not Git Bash.)
- Then: `gh pr comment 25 --body-file C:/Pluto-foundation-ingest/.review/review-1.md`.
  - APPROVE: edit the PR body's merge gate line to say so with the comment link. Grokbot merges.
  - CHANGES REQUIRED: fix the BLOCKING items once in `C:/Pluto-foundation-ingest`, rerun typecheck, lint, test, smoke, push, regenerate `.review/diff.patch` (`git diff agent/foundation...HEAD -- . ':!package-lock.json' ':!seed/pdfs/*.pdf'`), run one re-review into `review-2.md`, post it. Still blocked after that: escalate to the director.

## 2. Issues #6, #7, #8 (core tools)
- #5 is closed: fixed by commit `7d30818`.
- Brief: `orchestrations/tasks/foundation-tools-fixes.md`. Worktree `C:/Pluto-foundation-tools-fixes` on branch `agent/foundation-tools-fixes` exists. **No coder has been started yet**; it waits for the #25 reviewer to exit because of memory.
- Start it (herdr workspace `$HERDR_WORKSPACE_ID`):
  ```
  herdr tab create --workspace $HERDR_WORKSPACE_ID --cwd C:/Pluto-foundation-tools-fixes --label foundation-tools-fixes --no-focus
  herdr agent start foundation-tools-fixes --kind cursor --pane <new tab's root pane> --timeout 120000 -- --force --trust --model grok-4.7-medium
  herdr agent prompt foundation-tools-fixes "Read orchestrations/tasks/foundation-tools-fixes.md and do the task exactly. Open the PR, print its URL, then stop."
  herdr agent send-keys foundation-tools-fixes enter     # Cursor needs this to submit; repeat once after a few seconds if still idle
  herdr agent wait foundation-tools-fixes --until working
  ```
- Its PR goes into `agent/foundation` with no `security-review` label. Gate: CI green. Read the diff: every query still has `.eq("student_id", ctx.studentId)`, no contract shape change, no files outside `packages/core/src/tools` and `packages/core/test/tools`. Grokbot merges. Close the tab after the merge.

## 3. F2 milestone PR (as soon as #25 merges; do not wait for the tools fixes)
In `C:/Pluto-foundation`:
1. `git pull --no-rebase origin agent/foundation`, then `git fetch origin && git merge origin/agent/pluto` (for files foundation does not own, take `agent/pluto`'s version; PROTOCOL 2e).
2. `npm ci`, `npm run typecheck`, `npm run lint`, `npm run seed`, `npm test`, `npm run smoke`. Stop anything you start.
3. Update `orchestrations/reports/foundation-F2.md`: section 4 row for #25 (verdict and link), section 3 with the fresh output, add the tools-fixes PR status under section 5. Commit and push.
4. `gh pr create --base agent/pluto --head agent/foundation --title "Foundation F2: PDF ingest, search, core tools, helpers"` with the body from `.github/pull_request_template.md`, pointing to the report. Add label `security-review` and state the per-PR verdicts in the merge gate.
5. Tell the director the PR number in one paragraph. Agents never merge.

## Rules that are easy to break
- Never run `supabase db reset` or `supabase stop` on the shared stack. Side containers (analytics, vector, studio, edge runtime, realtime) were stopped on purpose to save memory.
- Never push to `main` or `agent/pluto`. Never merge a PR.
- Do not edit harden-owned files: `20261113000500_harden_student_writes.sql`, its tests in `packages/core/test/db`, the static-asset bypass in `apps/web/proxy.ts`.
- `files` rows are written only with the service role; ingest builds the storage path from `student_id` and file id.
- `C:/Pluto/.env.secrets` holds real keys: never copy it into a repo.
- Close only tabs you created. Worktrees `C:/Pluto-foundation-{db,contract,shell,tools,helpers,ingest,tools-fixes}` stay until their branches are merged and clean.
