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
# Pass your Cursor account through so coders and reviewers bill the same account you do (see 2d):
TAB=$(herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd C:/Pluto-$NAME --label $NAME --no-focus ${CURSOR_API_KEY:+--env CURSOR_API_KEY=$CURSOR_API_KEY})
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
- Cursor panes sometimes paste a prompt without submitting it (`agent_prompt_stalled`, screen shows `[Pasted text ...]`). Then run `herdr agent send-keys $NAME enter` once and check it went `working`.
- Never answer an approval prompt that grants new access (MCP servers, etc.). If a coder is `blocked`, read it with `herdr agent read`; if it needs Allen, tell the director.
- Track each coder with a background `herdr agent wait $NAME` (no polling). On wake, `herdr agent read $NAME --source recent-unwrapped --lines 80` to see whether it is really done or just paused. Cursor planners: see 2d.

## 2d. If you are a Cursor planner
- You have no background-job notifications. While coders or reviewers are running, block in the foreground with `herdr agent wait <name> --timeout 900000` (repeat as needed) and keep your turn going; do not end your turn while your own agents are working.
- When everything left is waiting on grokbot (PRs open, CI green, nothing running), end your turn with one line starting `WAITING_GROKBOT:` listing the PR numbers. The director watches GitHub and prompts you when they merge or get review comments.
- Your Cursor account is whatever `CURSOR_API_KEY` is in your environment (empty means the default logged-in account). Never print the key, never write it to a file in a repo, and pass it to coder tabs only via `--env` as in section 2. Headless reviewers inherit it automatically.
- Model for coders: per 2b.

## 2b. Usage policy: Claude vs Cursor
Claude coders, reviewers and orchestrators all share Allen's one Claude 5-hour meter (shown in every Claude tab's status bar). Hitting 100% stalls every Claude agent, including you, until it resets.
- **Model availability changed (2026-11-14 07:00).** The Cursor CLI is now logged into Allen's second account, which only includes `composer-2.5`, `auto` and the Grok models. `gpt-5.3-codex`, Sonnet 5, Opus 5 and GPT-5.6 fail with "not included in your weekly usage". Use:
  - planners: `grok-4.7-high`
  - coders: `composer-2.5` (UI, mechanical) or `grok-4.7-medium` (logic); `grok-4.7-high` for security-sensitive fixes
  - fresh reviewers: `grok-4.7-high`, via `cursor-agent -p --force --trust --model grok-4.7-high "<same reviewer prompt>"`
- Use a Claude coder only for work that clearly needs it, and only while your status bar shows the 5-hour meter under 60%.
- Cursor coders get the same brief and protocol; their pane is still checked with `herdr agent read`. If `herdr agent wait` never reports idle for a Cursor agent, read the pane to judge completion.

## 2e. Branch ancestry
Grokbot squash-merges, so after a milestone PR lands in `agent/pluto`, your slice branch and `agent/pluto` no longer share history and a plain merge shows add/add conflicts. Sync through a dedicated PR: branch `agent/<orch>-sync` from your slice branch, `git merge origin/agent/pluto`, resolve every file you don't own by taking `agent/pluto`'s version (`git checkout --theirs`), keep your own files, run all checks, PR into `agent/<orch>`. Never mix a sync into a feature PR.

## 2c. Memory cap (16 GB machine, shared by everyone)
The machine has 16 GB and already ran out once (background shells were killed).
- At most 2 coders running at once per orchestrator. Queue the rest.
- Run reviewers one at a time.
- Never leave `npm run dev` or `next dev` running after a check; stop it. Only one dev server per worktree at a time.
- Close a coder's tab as soon as its PR is merged; an idle agent still holds memory.
- Before spawning, check free memory (`powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB"`); under 2 GB free, wait for a running coder to finish.

## 3. Coder brief must contain
Goal, owned files, contract items, acceptance checks (observable commands and expected output), port, migration sub-range, which mocks to use, "push after every commit", PR target `agent/<orch>`, and the PR body checklist (contract items touched, check output tails, how to UI-test).

## 4. Who reviews what
Grokbot (Allen's GitHub reviewer) reviews and merges every PR: coder PRs into `agent/<orch>` and milestone PRs into `agent/pluto`. It also runs UI checks on the Vercel preview. Nobody else merges.

A fresh headless reviewer is still required, before grokbot sees the PR, for any PR that touches:
- `supabase/migrations/**`, RLS policies or storage policies
- authentication: login, sessions, middleware, MCP OAuth or the demo bearer token, `/oauth/consent`
- magic links (`createMagicLink`, `consumeMagicLink`, `/open/[token]`)
- the SMS webhook (`/api/sms/inbound`) or any route using the service-role key or `INTERNAL_API_SECRET`
- Canvas token encryption

Label those PRs `security-review` (`gh pr edit <pr> --add-label security-review`, create the label once if missing). Every other PR skips the fresh reviewer.

Fresh review, for labeled PRs only. It gets only CLAUDE.md, REVIEW.md, the contract, the task's goals and acceptance checks, and the diff:
```bash
git -C C:/Pluto-$NAME diff agent/$ORCH...HEAD > C:/Pluto-$NAME/.review/diff.patch   # .review is gitignored
cursor-agent -p --force --trust --model gpt-5.3-codex "You are a fresh reviewer. Follow REVIEW.md exactly. Goals and acceptance checks: orchestrations/tasks/$NAME.md. Diff: .review/diff.patch (base agent/$ORCH). Write your report to .review/review-1.md and print it." > C:/Pluto-$NAME/.review/review-1.log
gh pr comment <pr> --body-file C:/Pluto-$NAME/.review/review-1.md
```
Run it from the coder's worktree after the coder is idle. Never give the reviewer the coder's transcript or your own opinion of the code.

## 5. Merge gate and fix loop
- GitHub can't enforce required checks on this private repo, so the gate is a rule: a PR is ready for grokbot only when CI (`check`) is green and, if labeled, the fresh review says `VERDICT: APPROVE`. State both in the PR body. Never ask grokbot to merge a red PR.
- Fresh review CHANGES REQUIRED: prompt the coder with the review file path; one fix round; one fresh re-review. Still blocking: security or contract items go to the director (write `orchestrations/escalations/<orch>-<n>.md`, commit, push, stop that task and go idle).
- Grokbot comments with problems: prompt the coder to fix them on the same branch. If grokbot and the contract disagree, the contract wins; escalate to the director.
- After grokbot merges a coder PR: `git pull` in your worktree and rerun typecheck, lint, test (and smoke once it exists) yourself. If the merged result is broken, fix it with a new coder PR right away.
- Track merges with `gh pr view <pr> --json state,mergedAt` when a coder goes idle or grokbot comments; do not poll in a tight loop.

## 6. Milestone PR to the integration branch
- Cadence: about every 2 hours, or as soon as a timeline row in BRIEF works on your branch. Don't wait to finish your whole slice.
- First sync your branch with `agent/pluto` through a sync PR (section 2e), rerun typecheck/lint/test/smoke yourself, write the report (`orchestrations/reports/<orch>-<milestone>.md`, see BRIEF), push, and open `gh pr create --base agent/pluto --head agent/<orch>`. Ask grokbot in the PR body to merge with a merge commit, not squash.
- The PR body: summary, contract items touched, check output tails, fresh-review verdicts for labeled PRs, the report path, and a "How to UI-test (for grokbot)" section.
- Then go idle. Grokbot reviews and merges. The director reruns the checks on `agent/pluto` after each merge and sends you fixes if the combined branch breaks.

## 7. Hygiene
- Commit small, push after every commit.
- Never edit files outside your slice; never edit `docs/plan.md`.
- Never push to `main` or `agent/pluto` directly. Never deploy.
- Close the coder tabs you created once their PRs are merged (`herdr tab close <tab>`), and remove their worktrees only when clean and merged.
- Tell the director (via your report) if usage looks heavy.
