# Coder task: foundation-shell

Branch `agent/foundation-shell`, worktree `C:/Pluto-foundation-shell`, base and PR target `agent/foundation`. Build step 1 support: the web app scaffold the web, mcp, canvas and assistant slices build inside. Port 3003. No migrations.

## Goal
A Next.js App Router app in `apps/web` (workspace name `@pluto/web`) with Tailwind and shadcn/ui initialised, Supabase SSR helpers, session-refresh middleware, and an `(app)` route group whose layout redirects signed-out visitors to `/login`. Scaffold only: the real screens belong to the web slice.

## You own (edit nothing else)
- `apps/web/**`, specifically: `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss`/Tailwind setup, `components.json`, `lib/utils.ts`, `lib/supabase/{server,client,admin}.ts`, `lib/env.ts`, `middleware.ts`, `app/layout.tsx`, `app/globals.css`, `app/(app)/layout.tsx`, `app/(app)/page.tsx` (tiny placeholder home the web slice will replace)
- `package-lock.json` (you are the only F1 coder allowed to change it; install only into `apps/web`: `npm install -w @pluto/web <pkg>`)

Do NOT create: `/login` (web owns it; a 404 there is expected for now), anything under `app/api`, `app/oauth`, `app/.well-known`, `app/open`, `app/cal`, `components/**` beyond what `shadcn init` itself writes, PWA manifest. Do not edit root `package.json`, root configs, `scripts/**`, `packages/**`, `.env.example`. Need a change there: say so in your final message.

## Requirements
- Latest stable Next.js, React, Tailwind, `@supabase/ssr`, `@supabase/supabase-js`. TypeScript strict; `tsconfig.json` extends `../../tsconfig.base.json`. Depend on `@pluto/core` (`"@pluto/core": "*"`) and set `transpilePackages: ['@pluto/core']` (core ships TypeScript source, imported by subpath such as `@pluto/core/contract`).
- `apps/web/package.json` scripts: `dev` (`next dev`; the root `npm run dev` appends `-p <port>`), `build`, `start`, `typecheck` (`tsc --noEmit`), `lint` (ESLint with the Next config; the root ESLint config ignores `apps/web`, so yours must be self-contained), optional `test`.
- `lib/env.ts`: small typed accessors that throw a clear error when a required variable is missing (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, server-only `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`, `INTERNAL_API_SECRET`).
- `lib/supabase/server.ts`: `createClient()` for Server Components / route handlers using `@supabase/ssr` cookies (`getAll`/`setAll`). `lib/supabase/client.ts`: browser client. `lib/supabase/admin.ts`: service-role client, `import 'server-only'`, `persistSession: false`, with a comment listing the only routes allowed to use it (see CLAUDE.md). Type them with `Database` from `@pluto/core/database.types` if that file exists on your branch; if not, leave them untyped with a one-line TODO for the orchestrator.
- `middleware.ts`: refreshes the Supabase session on every matched request (the standard `@supabase/ssr` `updateSession` pattern, calling `supabase.auth.getUser()`), and redirects signed-out requests to `/login?next=<path>` unless the path is public. Public prefixes: `/login`, `/open`, `/oauth`, `/.well-known`, `/api`, `/cal`, `/auth`, Next internals and static files (`/_next`, `/favicon.ico`, `/manifest.webmanifest`, `/sw.js`, images). API routes do their own auth, so middleware must never redirect them. If the installed Next version has renamed middleware to `proxy.ts`, use whichever file works without a build error and say which in the PR.
- `app/(app)/layout.tsx`: server component that calls `supabase.auth.getUser()` and `redirect('/login')` when there is no user (defence in depth behind the middleware), then renders a minimal mobile-first shell (header with the app name, `children`). `app/(app)/page.tsx`: placeholder that shows the signed-in email.
- Supabase calls that can fail (network down) must not crash the middleware: treat an error as signed out.
- Mobile first: the shell works at 390px wide with no horizontal scroll. Viewport meta set.
- `next build` must pass with no env vars beyond what `npm run env:local` writes.

## Environment
- `npm ci`, then `npm run env:local -- --port 3003` (the shared local Supabase stack is already running; never stop or reset it), then `npm run dev` from the repo root.
- Seed users may not exist yet while you work. To test the signed-in path, create a throwaway user with the service role key from `apps/web/.env.local` (admin API) and delete it afterwards.

## Acceptance checks (run them, paste real output tails in the PR body)
- `npm run typecheck && npm run lint && npm test` (repo root) -> green.
- `npm run build -w @pluto/web` -> succeeds.
- With the dev server on 3003: `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3003/` -> a 307/302 to `http://localhost:3003/login?next=%2F` (or equivalent); `curl -i http://localhost:3003/api/does-not-exist` -> 404, not a redirect.
- Signed-in check: with a real session cookie (or a short script using `@supabase/ssr`), `/` returns 200 and shows the user's email. Describe exactly what you ran.
- 390px check: describe how you verified it (browser devtools or a headless screenshot).

## Process
State the build step at the top of the PR. Commit small, `git push -u origin agent/foundation-shell` after every commit. Open a PR into `agent/foundation` (`gh pr create --base agent/foundation`) with summary, check output tails and a "How to UI-test" section, then reply `DONE <PR URL>`.
