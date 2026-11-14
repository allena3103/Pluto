# Coder task: canvas-ingest (Claude, opus): flat-branch wrapper

Branch `agent/canvas-ingest`, worktree `C:/Pluto-canvas-ingest`, based on `agent/pluto`, PR into **`agent/pluto`**. Port 3205. No migrations. Security-sensitive: labeled `security-review`.

Build `orchestrations/tasks/canvas-ingest-demo.md` (the whole file), with these changes:
- PR target is `agent/pluto`. Ignore the Cursor lines, the grokbot lines and "tell the canvas orchestrator". If something needs a decision, describe it and go idle.
- **It may be out of date.** Check every "already exists" claim against this branch before relying on it. Known differences:
  - `packages/canvas/src/deadline-alert.ts` may not exist. The sync route (`apps/web/app/api/canvas/sync/route.ts`) POSTs `/api/alerts/deadline-change` itself.
  - That alerts route is in PR #51 (`agent/alerts-cal`), not merged yet. Your demo trigger only has to make the sync path send that POST once. Test it with the POST injected or mocked.
  - Grokbot's #38 notes (fixture due dates are relative to the current week; failed notifications aren't retried) are context, not your task.
- Wiring `syncCanvasFiles` into `POST /api/canvas/sync` (after the metadata sync, same auth) is in scope. You own that call site in `apps/web/app/api/canvas/sync/route.ts` too.

## Delivery
`npm run typecheck`, `npm run lint`, `npm test`, `npm run build -w @pluto/web` once at the end. Never run a foreground server. Commit small, push after every commit. `gh pr create --base agent/pluto --head agent/canvas-ingest --title "Canvas: PDF download + ingest, demo date-change trigger"`, then `gh pr edit <n> --add-label security-review`. Reply `DONE <PR URL>` and go idle.
