# Coder task: web-signup (`/signup`)

Branch `agent/web-signup`, worktree `C:/Pluto-web-signup`, PR into **`agent/web`**. Port **3106**. Orchestrator: web. Build step 5 (UI half), director item 9 (2026-11-14). Model: Cursor `grok-4.7-medium`.

A new student creates an account with name, email, and password and lands signed in. This is authentication, so the PR is labeled `security-review` and gets a fresh reviewer before grokbot.

## Read first
- `CLAUDE.md`, `orchestrations/files/BRIEF.md`, `orchestrations/plans/web.md`.
- `apps/web/AGENTS.md`: **this is Next 16, not the Next you know.** Read the relevant guides in `node_modules/next/dist/docs/` first. `searchParams` is a Promise. Use `redirect()` from a server action.
- `apps/web/proxy.ts`: signed-out visitors are sent to `/login` unless the path is public. `/login` is public. `/signup` is not, until you add it.
- `apps/web/lib/supabase/server.ts`: the only client you use (`createClient`). Do not use `lib/supabase/admin.ts`.
- `supabase/migrations/20261113000100_schema.sql`: `handle_new_user` inserts `profiles (id, name)` from `raw_user_meta_data ->> 'name'`. You do not insert the profile yourself.
- `supabase/config.toml`: `enable_signup = true` and `enable_confirmations = false`. Do not edit it.
- **Never edit `packages/core/**`, `docs/plan.md`, `apps/web/app/login/**`, or `apps/web/package.json`.** PR #23 (the director) owns the login page. There is no `apps/web/lib/safe-next.ts` on this branch; do not create that path.

## Setup
```
npm install
npm run env:local -- --port 3106
npm run dev -w @pluto/web
```
Shared local Supabase is running and seeded. **Never `supabase db reset`, never `supabase start/stop`.** No migrations. Stop the dev server when you are not using it (the machine is short on memory).

Demo login, for the "already signed in" check: `demo@pluto.test` / `DEMO_STUDENT_PASSWORD` in `.env.example`.

## Files you own
- `apps/web/app/signup/**`
- `apps/web/proxy.ts`, and only this change: add `"/signup"` to `PUBLIC_PATH_PREFIXES`. Do not change the matcher, the cookie logic, or any other prefix.

## What to build

### 1. Public path
Add `"/signup"` next to `"/login"` in `PUBLIC_PATH_PREFIXES`. A signed-out `GET /signup` must return the page, not a redirect to `/login`.

### 2. `next` check
Put it in `apps/web/app/signup/safe-next.ts` (this task's file, not `lib/safe-next.ts`). Accept only a same-origin path that starts with a single `/`, with no `//` prefix, no backslash, and no scheme. Anything else falls back to `/`. Keep the query string. Examples that must fall back to `/`: `https://evil.example`, `//evil.example`, `/\evil`. Example that must be kept: `/oauth/consent?authorization_id=abc`.

### 3. The page
- Mobile first, Tailwind only, same visual language as `apps/web/app/(app)/grades/` (slate, rounded border, no new dependencies, no `@/components/ui`).
- Fields: name, email, password. Name is required after trim. Empty name does not call Supabase.
- Server action using `createClient()` from `lib/supabase/server.ts`:
  `supabase.auth.signUp({ email, password, options: { data: { name } } })`.
- On success, if the response includes a session, `redirect()` to the validated `next` or `/`.
- If `signUp` returns a user and no session, stop and tell the orchestrator. Confirmation is off locally; do not edit `config.toml` and do not try to confirm the email yourself.
- Do not write `profiles` yourself. The trigger copies `name`.
- Already signed in: redirect to the validated `next` or `/`.
- A link to `/login` that keeps the same `next` query. Do not edit the login page. The login page's link back to `/signup` is a later task.

### 4. Errors
- One generic failure message: "Could not create the account. If you already have one, sign in."
- You may show a Supabase error only when it does not tell the visitor whether that email is already registered. If it does (user already exists, or similar), use the generic message instead.
- Never log the password, never put the password or the email in the URL, never print the demo password.

## Acceptance checks (run them, paste the output in the PR)
```
npm run typecheck                 # exit 0
npm run lint                      # exit 0
npm test                          # existing tests passed, 0 failed
npm run build -w @pluto/web       # succeeds; /signup listed
```
Manual, dev server on 3106, browser at 390px. Use a unique email each try, for example `signup-<timestamp>@pluto.test`.
1. Signed out, `curl.exe -i http://localhost:3106/signup` is 200, not a 307 to `/login`.
2. Sign up with a name, that email, and a password. The browser lands on `/` signed in, and `profiles.name` for that user is the name you typed (check in the local Supabase studio or with a session-scoped select; do not use the service role in the page).
3. `/signup?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dabc` after sign-up lands on `/oauth/consent?authorization_id=abc` (a 404 page is fine; the URL is what matters).
4. `next=https%3A%2F%2Fevil.example`, `next=%2F%2Fevil.example`, `next=%2F%5Cevil.example` all land on `/`.
5. Signing up again with the same email shows the generic message, not a stack trace.
6. While signed in as the demo student, `GET /signup` redirects to `/` (or to a valid `next`).
7. The page has a link to `/login`. No horizontal scroll at 390px.
8. `git diff agent/web...HEAD --stat` shows only `apps/web/app/signup/**` and the one-line `proxy.ts` change.

## Contract items touched
No zod shape changes. Director decision 2026-11-14: `/signup` via `supabase.auth.signUp`, name in user metadata, email confirmation off, validated `next`, link to `/login`. If the trigger does not copy `name`, stop and tell the orchestrator. Do not edit the migration.

## Rules
- Commit small, push after every commit (`git push -u origin agent/web-signup` the first time).
- **Open the PR and stop. Never merge it** (no `gh pr merge`, no local merge into `agent/web`, no push to `agent/web`). Grokbot reviews, UI-tests and merges. This PR also needs a fresh security review first.
- Add the label: `gh pr edit <pr> --add-label security-review`.
- Never commit `.env.local` or a secret.
- Stay in the files listed above.

## PR
Use `.github/PULL_REQUEST_TEMPLATE.md`: summary, build step and contract items, real output tails, merge-gate checkboxes (including the `security-review` verdict line, left blank until the reviewer comments), and "How to UI-test (for grokbot)" with the numbered steps above.

When the PR is open, reply `DONE` with the PR URL.
