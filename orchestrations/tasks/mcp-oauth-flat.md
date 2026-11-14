# Coder task: mcp-oauth (Claude, opus) — flat-branch wrapper

Branch `agent/mcp-oauth`, worktree `C:/Pluto-mcp-oauth`, based on `agent/pluto`, PR into **`agent/pluto`**. Security-sensitive: labeled `security-review`.

Build `orchestrations/tasks/mcp-oauth.md` exactly, with these changes:
- PR target is `agent/pluto`, not `agent/mcp`. Ignore its Cursor/model and grokbot lines.
- Its local OAuth round trip must run on port 3000. Run that server in the background only, and stop it afterwards.
- The hosted Supabase project already has the OAuth server, dynamic client registration, and the consent path configured. Don't change hosted settings.
- Also do the two follow-ups from `orchestrations/HANDOFF.md` (mcp section): `logging.incomingRequests.ignore` for `/api/mcp/demo/` in `apps/web/next.config.ts` (that one-key edit is allowed), and log `ToolError` `db_error` causes server-side without returning them.
- Leave `PLUTO_DEMO_MCP_URL_ENABLED` handling unchanged; the director turns it off after the demo.

## Delivery
`npm run typecheck`, `npm run lint`, `npm test`, `npm run build -w @pluto/web` once at the end. Commit small, push after every commit. `gh pr create --base agent/pluto --head agent/mcp-oauth --title "MCP: OAuth 2.1 sign-in"`, then `gh pr edit <n> --add-label security-review`. Reply `DONE <PR URL>` and go idle. Stop and describe anything that needs a decision.
