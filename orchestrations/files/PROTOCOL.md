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
- Never answer an approval prompt that grants new access (MCP servers, etc.). If a coder is `blocked`, read it with `herdr agent read`; if it needs Allen, tell the director.
- Track each coder with a background `herdr agent wait $NAME` (no polling). On wake, `herdr agent read $NAME --source recent-unwrapped --lines 80` to see whether it is really done or just paused.

## 3. Coder brief must contain
Goal, owned files, contract items, acceptance checks (observable commands and expected output), port, migration sub-range, which mocks to use, "push after every commit", PR target `agent/<orch>`, and the PR body checklist (contract items touched, check output tails, how to UI-test).

## 4. Fresh review (headless, no shared context)
For every coder PR, run a fresh reviewer in a clean checkout of the PR branch. It gets only CLAUDE.md, REVIEW.md, the contract, the task's goals and acceptance checks, and the diff.
```bash
git -C C:/Pluto-$NAME diff agent/$ORCH...HEAD > C:/Pluto-$NAME/.review/diff.patch   # .review is gitignored
claude -p --permission-mode auto "You are a fresh reviewer. Follow REVIEW.md exactly. Goals and acceptance checks: orchestrations/tasks/$NAME.md. Diff: .review/diff.patch (base agent/$ORCH). Write your report to .review/review-1.md and print it." > C:/Pluto-$NAME/.review/review-1.log
gh pr comment <pr> --body-file C:/Pluto-$NAME/.review/review-1.md
```
Run it from the coder's worktree (`cwd`) after the coder is idle. `cursor-agent -p --force --trust` is an acceptable reviewer CLI. Never give the reviewer the coder's transcript or your own opinion of the code.

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
