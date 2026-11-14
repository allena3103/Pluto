# Coder task: web-open (magic-link open on a phone)

Branch `agent/web-open`, worktree `C:/Pluto-web-open`, PR into **`agent/web`**. Port **3105**. Orchestrator: web. Build step 6 (magic-link half).

A student gets an SMS with a one-time link, taps it on their phone, and lands signed in on the exact notes page. This is the most security-sensitive route in the web slice: it uses the service-role key and it creates a session. Your PR is labeled `security-review` and gets a fresh reviewer before grokbot.

**Prerequisite:** core's `consumeMagicLink` (foundation F2). Do not start until the orchestrator tells you it is on `agent/web`; check with `Select-String -Path packages/core/src/magic-links.ts -Pattern "consumeMagicLink"`.

## Read first
    10|- `CLAUDE.md`, `orchestrations/files/BRIEF.md`, `orchestrations/plans/web.md`.
- `apps/web/AGENTS.md`: **this is Next 16, not the Next you know.** Read the relevant guides in `node_modules/next/dist/docs/` first. `params` is a Promise. Redirects from a route handler or page: use `redirect()` / `NextResponse.redirect`.
- `packages/core/src/contract.ts`: `OpenParams`, `OPEN_RESPONSE` (302, success `notePath(fileId, page)`, failure `/login?error=link`), `MagicLinkRequest/Response`. `packages/core/src/magic-links.ts`: `createMagicLink`, `consumeMagicLink` — read their exact signatures and use them; **never edit `packages/core/**` or `docs/plan.md`**.
- `supabase/migrations/20261113000100_schema.sql`, table `magic_links`: `token_hash` (SHA-256 hex, the raw token is never stored), `file_id`, `page`, `expires_at`, `used_at`, `student_id`. It has **no** client grants or policies: service role only.
- `apps/web/lib/supabase/admin.ts` (`createAdminClient`, service role; this route is on its allowed list), `apps/web/lib/safe-next.ts` and `apps/web/app/login/**` from `web-shell`.
- `apps/web/proxy.ts` already treats `/open` as public. Do not edit it.

## Setup
```
npm install
npm run env:local -- --port 3105
    20|npm run dev -w @pluto/web
```
Shared local Supabase is running and seeded. **Never `supabase db reset`, never `supabase start/stop`.** No migrations. Stop the dev server when you are not using it (~2 GB free memory).

## Files you own (touch nothing else)
- `apps/web/app/open/**`

Do not edit `apps/web/package.json` or the lockfile. Do not add a new Supabase client helper; use `createAdminClient` and `lib/supabase/server.ts`.

## What to build: `GET /open/[token]`
    30|1. `await params`, take `token`, validate with `OpenParams`. Anything invalid -> 302 to `/login?error=link`.
2. Call core `consumeMagicLink` with a service-role client. It must be the thing that hashes the token, checks `expires_at`, checks `used_at` is null, and marks it used **atomically** (single use even when two taps race). If the core helper does not already guarantee single use atomically, **stop and tell the orchestrator** rather than writing your own token logic in the route.
3. On success you have `{ studentId, fileId, page }`. Establish a session **for that student only**:
   - `createAdminClient().auth.admin.generateLink({ type: "magiclink", email: <that student's email> })`, take the returned `token_hash` (or `hashed_token`), then verify it with the **session** client (`lib/supabase/server.ts`) via `supabase.auth.verifyOtp({ type: "email", token_hash })` so the cookies are written for this response.
   - Read the student's email from `auth.users` by `studentId` with the admin client. Never take an email, student id, file id or page from the query string or a header.
   - Confirm the resulting session's user id equals `studentId`; if it does not, sign out and redirect to `/login?error=link`.
4. Redirect 302 to `notePath(fileId, page)` from `@pluto/core/deep-links` (never build the path by hand, 1-based page).
5. Any failure (unknown, expired, already used, student missing, session creation failed): 302 to `/login?error=link`. One generic outcome: never say which of those it was, never echo the token, and **never log the token or the email**.
    40|6. `export const dynamic = "force-dynamic"`; set `Cache-Control: no-store` on the redirect so no proxy or service worker can cache it. Keep the handler fast and give every external call a timeout (the shared Supabase clients already carry one).
7. Do not send the student to a `next` parameter or any URL from the request: the destination comes only from the consumed row.

## Acceptance checks (run them, paste the output in the PR)
```
npm run typecheck                 # exit 0
npm run lint                      # exit 0
npm test                          # 136+ passed, 0 failed
npm run build -w @pluto/web       # succeeds; /open/[token] listed
```
Manual (dev server on 3105). Write the scratch script that mints links under `.review/` (gitignored), using core `createMagicLink` with a service-role client and a seeded demo file id (after F2's ingest seed, `/notes` lists them):
    50|1. Fresh browser profile (or a cleared cookie jar), open `/open/<token>` -> 302 to `/notes/<fileId>?page=<n>`, the page renders, and the header shows the demo student signed in.
2. Open the same token again -> 302 to `/login?error=link`, and the browser is **not** signed in as anyone new.
3. A token minted with a past `expires_at` -> `/login?error=link`.
4. Garbage token (`/open/nope`, `/open/` + 600 chars, `/open/..%2Fetc`) -> `/login?error=link`, no stack trace, no 500.
5. A token belonging to `other@pluto.test` opened in a browser already signed in as the demo student -> the session that results is the other student's **or** the request fails; it must never show the demo student the other student's file. Say in the PR which happens.
6. `curl.exe -i http://localhost:3105/open/<token>` -> 302 with `Set-Cookie` and `Cache-Control: no-store`; the response body does not contain the token.
7. `git log -p` on your branch contains no token, email or key.

## Contract items touched
`ENDPOINTS.open` and `OPEN_RESPONSE` (302, `/notes/<fileId>?page=<n>` on success, `/login?error=link` otherwise), consuming core `consumeMagicLink`. No shape changes; if the contract or the core helper does not fit, **stop** and tell the orchestrator.
    60|
## Rules
- Commit small, push after every commit (`git push -u origin agent/web-open` the first time).
- **Open the PR and stop. Never merge it** (no `gh pr merge`, no local merge into `agent/web`, no push to `agent/web`). Grokbot reviews, UI-tests and merges every PR, and this PR also needs a fresh security review first.
- Service role is allowed **only** in this route and only after the token verifies. Never expose it to the client, never put it in a log line.
- Never commit `.env.local`, a token, an email or a key.
- Stay in `apps/web/app/open/**`.
- Expect one fix round from the fresh reviewer, then one re-review.

## PR body
Use `.github/PULL_REQUEST_TEMPLATE.md`: summary, build step and contract items, real output tails, merge-gate checkboxes (including the `security-review` verdict line), and "How to UI-test (for grokbot)" with the numbered steps above plus how to mint a test link.
    70|
Add the label yourself if you can: `gh pr edit <pr> --add-label security-review`. When the PR is open, reply `DONE` with the PR URL.
