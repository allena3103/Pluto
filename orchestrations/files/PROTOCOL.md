# Orchestrator protocol

You are an orchestrator. Read `CLAUDE.md`, `docs/plan.md`, `orchestrations/files/BRIEF.md` and your task file first.

## 1. Plan
- Write `orchestrations/plans/<orch>.md` on your branch: tasks, the files each task owns (no overlaps), dependencies, which CLI runs each coder, and acceptance checks per task. Commit and push it before spawning anyone.
- Size tasks so one coder finishes in 1-3 hours. Spawn as many coders as the work genuinely splits into; serialize only true dependencies.
- Shared prerequisite inside your slice (e.g. a package skeleton): build it yourself or with one coder first, merge it, then fan out.

## 2. Spawn a coder (visible herdr tab, own worktree)
```bash
ORCH=<orch>; TASK=<task>; NAME=$ORCH-$TASK
git fetch origin && git worktree add C:/Pluto-$NAME -b agent/$NAME agent/$ORCH
# write the coder brief to orchestrations/tasks/$NAME.md on agent/$ORCH, commit, push, so the worktree has it
TAB=$(herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd C:/Pluto-$NAME --label $NAME --no-focus)
PANE=$(echo "$TAB" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).result.root_pane.pane_id))")
# Claude coder:
herdr agent start $NAME --kind claude --pane $PANE -- --permission-mode auto
# Cursor coder (good for UI-heavy tasks):
# herdr agent start $NAME --kind cursor --pane $PANE -- --force --trust
herdr agent wait $NAME --until idle --timeout 120000
herdr agent prompt $NAME "Read CLAUDE.md, orchestrations/files/BRIEF.md and orchestrations/tasks/$NAME.md, then do the task. Push often. When done, open a PR into agent/$ORCH and reply DONE with the PR URL." --wait --until working --timeout 60000
```
- Panes open in PowerShell; run the snippet above from your own Bash tool, not inside the pane.
- If `agent start` returns `agent_not_ready`, run `herdr agent read $NAME --source visible --lines 30`. If it is Claude's "trust this folder" prompt for a `C:/Pluto-*` worktree, accept it (`herdr agent send-keys $NAME down` then `enter`); Allen approved that. Any other approval prompt (MCP servers, new access): do not answer; tell the director.
- Never answer an approval prompt that grants new access (MCP servers, etc.). If a coder is `blocked`, read it with `herdr agent read`; if it needs Allen, tell the director.
- Track each coder with a background `herdr agent wait $NAME` (no polling). On wake, `herdr agent read $NAME --source recent-unwrapped --lines 80` to see whether it is really done or just paused.

## 2b. Usage policy: Claude vs Cursor
Claude coders, reviewers and orchestrators all share Allen's one Claude 5-hour meter (shown in every Claude tab's status bar). Hitting 100% stalls every Claude agent, including you, until it resets.
- Default new coders to Cursor: `herdr agent start $NAME --kind cursor --pane $PANE -- --force --trust --model <model>`. Good picks: `gpt-5.3-codex` (backend/logic), `composer-2.5` (fast UI and mechanical work), `claude-sonnet-5-thinking-high` (tricky mixed work, billed to Cursor, not the Claude meter).
- Reviewers run on Cursor by default: `cursor-agent -p --force --trust --model gpt-5.3-codex "<same reviewer prompt>"`. A different model family from the coder is preferred.
- Use a Claude coder only for work that clearly needs it, and only while your status bar shows the 5-hour meter under 60%.
- Cursor coders get the same brief and protocol; their pane is still checked with `herdr agent read`. If `herdr agent wait` never reports idle for a Cursor agent, read the pane to judge completion.

## 2c. Memory cap (16 GB machine, shared by everyone)
The machine has 16 GB and already ran out once (background shells were killed).
- At most 2 coders running at once per orchestrator. Queue the rest.
- Run reviewers one at a time.
- Never leave `npm run dev` or `next dev` running after a check; stop it. Only one dev server per worktree at a time.
- Close a coder's tab as soon as its PR is merged; an idle agent still holds memory.
- Before spawning, check free memory (`powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB"`); under 2 GB free, wait for a running coder to finish.

## 3. Coder brief must contain
Goal, owned files, contract items, acceptance checks (observable commands and expected output), port, migration sub-range, which mocks to use, "push after every commit", PR target `agent/<orch>`, and the PR body checklist (contract items touched, check output tails, how to UI-test).

## 4. Fresh review (headless, no shared context)
For every coder PR, run a fresh reviewer in a clean checkout of the PR branch. It gets only CLAUDE.md, REVIEW.md, the contract, the task's goals and acceptance checks, and the diff.
```bash
git -C C:/Pluto-$NAME diff agent/$ORCH...HEAD > C:/Pluto-$NAME/.review/diff.patch   # .review is gitignored
claude -p --permission-mode auto "You are a fresh reviewer. Follow REVIEW.md exactly. Goals and acceptance checks: orchestrations/tasks/$NAME.md. Diff: .review/diff.patch (base agent/$ORCH). Write your report to .review/review-1.md and print it." > C:/Pluto-$NAME/.review/review-1.log
gh pr comment <pr> --body-file C:/Pluto-$NAME/.review/review-1.md
```
Run it from the coder's worktree (`cwd`) after the coder is idle. Per section 2b, default to `cursor-agent -p --force --trust --model gpt-5.3-codex` in place of `claude -p`. Never give the reviewer the coder's transcript or your own opinion of the code.

## 5. Fix loop
CHANGES REQUIRED -> prompt the coder with the review file path; one fix round; one fresh re-review (new headless session). Still blocking: you decide non-security items; security or contract items go to the director (`herdr agent prompt director ...` is not available; write `orchestrations/escalations/<orch>-<n>.md`, commit, push, and stop that task). APPROVE -> `gh pr merge <pr> --squash --delete-branch=false`, then pull into your worktree.

## 6. Milestone PR to the integration branch
- Rebase or merge `origin/agent/pluto` into your branch, rerun typecheck/lint/test/smoke yourself, write the final report (`orchestrations/reports/<orch>-<milestone>.md`, see BRIEF), push, and open `gh pr create --base agent/pluto --head agent/<orch>`.
- The PR body: summary, contract items touched, check output tails, the report path, and a "How to UI-test (for grokbot)" section.
- Then go idle. The director reviews, waits for grokbot, merges, and prompts you with the next step or with fixes.

## 7. Hygiene
- Commit small, push after every commit.
- Never edit files outside your slice; never edit `docs/plan.md`.
- Never push to `main` or `agent/pluto` directly. Never deploy.
- Close the coder tabs you created once their PRs are merged (`herdr tab close <tab>`), and remove their worktrees only when clean and merged.
- Tell the director (via your report) if usage looks heavy.
