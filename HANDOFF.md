# Handoff: foundation-shell (Claude coder stopped on a usage limit; Cursor continues in this worktree)

Task brief: `orchestrations/tasks/foundation-shell.md`. Branch `agent/foundation-shell`, PR target `agent/foundation`, port 3003.

## Done and pushed (commit 67aadf1)
- `apps/web/package.json` (`@pluto/web`) with `dev`, `build`, `start`, `typecheck`, `lint` scripts and the `@pluto/core` dependency.
- Installed with the lockfile updated: Next 16, React 19, Tailwind 4, `@supabase/ssr`, `@supabase/supabase-js`, `server-only`, `eslint-config-next`.

## Not done (everything else in the brief)
- No scaffold source files exist yet: `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `app/globals.css`, `lib/env.ts`, `lib/supabase/{server,client,admin}.ts`, the session middleware, `app/layout.tsx`, `app/(app)/layout.tsx`, `app/(app)/page.tsx`.
- `shadcn init` (`components.json`, `lib/utils.ts`).
- Every acceptance check, and the PR.

## Notes from the previous coder
- Next 16 renamed `middleware.ts` to `proxy.ts` with an exported `proxy` function. Use `proxy.ts` and say so in the PR.
- `@pluto/core/database.types` does not exist on this branch: leave the Supabase clients untyped with a one-line TODO.
- `npm run env:local -- --port 3003` has not been run yet. The shared local Supabase stack is running; never stop or reset it.
- One `npm install -w @pluto/web` silently recorded nothing the first time: check `apps/web/package.json` after any install.
- Write files with your file-editing tool, not shell heredocs (the earlier attempt failed on shell quoting).

Delete this file in your last commit before opening the PR.
