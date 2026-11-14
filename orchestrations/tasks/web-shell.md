# Coder task: web-shell (login, app shell, PWA, ui primitives, deps)

Branch `agent/web-shell`, worktree `C:/Pluto-web-shell`, PR into **`agent/web`**. Port **3101**. Orchestrator: web. Build step 5 (UI half) and 11 (PWA).

You are the shared prerequisite for the whole web slice: four more coders build on top of what you land, and you are the only one allowed to touch `apps/web/package.json` and the lockfile. Keep it tight and land it fast.

## Read first
- `CLAUDE.md`, `orchestrations/files/BRIEF.md`, `orchestrations/plans/web.md`.
- `apps/web/AGENTS.md`: **this is Next 16, not the Next you know.** Read the relevant guides in `node_modules/next/dist/docs/` (resolve from `apps/web`) before writing code. Known differences that will bite you: `middleware.ts` is now `apps/web/proxy.ts` (already written, do not duplicate it), and `params` / `searchParams` in pages are Promises you must `await`.
    10|- `packages/core/src/contract.ts` for shapes. **Never edit `packages/core/**` or `docs/plan.md`.**
- Existing scaffold you build on, do not rewrite: `apps/web/proxy.ts`, `apps/web/lib/supabase/{server,client,admin,fetch}.ts`, `apps/web/lib/env.ts`, `apps/web/components.json` (shadcn: new-york, slate, cssVariables, `@/components`, lucide).

## Setup
```
npm install
npm run env:local -- --port 3101      # writes apps/web/.env.local from the running local Supabase stack
npm run dev -w @pluto/web             # or `npm run dev` from the repo root; PORT comes from .env.local
```
The shared local Supabase stack is already running. **Never run `supabase db reset` or `npx supabase start/stop`.** You need no migrations; if you think you do, stop and tell the orchestrator. Mocks: `PLUTO_LLM=mock`, `SMS_PROVIDER=simulator`, `CANVAS_MODE=fixtures` (already in `.env.local`).
    20|Demo login: `demo@pluto.test`, password in `.env.example` (`DEMO_STUDENT_PASSWORD`). If the login fails, run `npm run seed` once (it is idempotent and resets the seeded passwords).
Stop the dev server when you are not actively using it: the machine has ~2 GB free memory.

## Files you own (touch nothing else)
- `apps/web/app/login/**` — the login page and its server action(s).
- `apps/web/app/(app)/layout.tsx` — replace the placeholder shell with the real one.
- `apps/web/app/(app)/page.tsx` — replace the "signed in as" placeholder.
- `apps/web/app/layout.tsx` — add only the PWA bits (manifest link, theme color) to the existing metadata/viewport.
- `apps/web/app/globals.css` — add the shadcn theme tokens (scope note: this file came from the foundation scaffold; the web slice takes it for theming. Do not restructure it beyond the tokens and base styles).
- `apps/web/app/manifest.ts` (preferred) or `apps/web/public/manifest.webmanifest`.
    30|- `apps/web/components/ui/**` — shadcn primitives.
- `apps/web/components/app-nav.tsx`, `apps/web/components/pwa-register.tsx`.
- `apps/web/lib/safe-next.ts` — the `next`-param validator, exported so other routes can reuse it.
- `apps/web/public/**` — icons, `sw.js`.
- `apps/web/package.json` and the root `package-lock.json` (you only; add deps with `npm install -w @pluto/web <dep>`).

## What to build

### 1. `/login`
- Supabase email + password sign-in, mobile first. Use `@supabase/ssr` through `lib/supabase/server.ts` in a server action (so the session cookies are written server-side) and `redirect()` on success. Do not add a new Supabase client.
- Honour `?next=<path>`: after sign-in, redirect there. **Validate it** in `lib/safe-next.ts`: accept only a same-origin path that starts with a single `/`, with no `//` prefix, no backslash and no scheme; anything else falls back to `/`. The MCP consent page sends users here as `/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3D...` and must come back to that exact path with its query string intact.
    40|- `?error=link` (sent by `/open/:token`, see `OPEN_RESPONSE.invalidLocation` in the contract) renders "That link has expired or was already used. Sign in to keep going."
- Wrong password / unknown email: a single generic "Email or password is wrong" message. Never reveal whether the email exists, never log the password, never put credentials in the URL, and do not print the demo password in the UI.
- An already-signed-in visitor to `/login` is redirected to the validated `next` (or `/`).
- Optional, only if it costs you nothing: a magic-email link. Skip it otherwise.

### 2. App shell in `(app)`
- Keep the existing server-side guard (`supabase.auth.getUser()` then `redirect("/login")`); add `next` to that redirect so a deep-linked signed-out user comes back to where they were.
- Mobile-first shell: a sticky bottom nav (or a top nav plus a drawer, your call) with **Chat** `/chat`, **Notes** `/notes`, **Grades** `/grades`, **Deadlines** `/deadlines`, and a less prominent link each to `/settings/canvas` (canvas slice) and `/sms-sim` (assistant slice). Those four to six routes 404 until their owners land them — that is expected; the links must still be right.
- Active-route highlighting, max-width container that is comfortable on a phone and not silly on a laptop, safe-area padding at the bottom.
- Sign out: a server action calling `supabase.auth.signOut()`, then `redirect("/login")`.
    50|- `(app)/page.tsx`: a small home screen (greeting with the student's name from `profiles`, and cards linking to the four screens). Keep it cheap: no new data layer, and if you query, use the session client from `lib/supabase/server.ts` and filter by the signed-in student's id explicitly.

### 3. shadcn primitives and dependencies
Add with the shadcn CLI (`npx shadcn@latest add ...`) so `components.json` is respected: `button`, `input`, `label`, `card`, `badge`, `skeleton`, `separator`, `alert`, `scroll-area`. Nothing else unless you use it.
Also install, **so that no later coder has to touch `package.json`**: `pdfjs-dist` (the notes viewer coder needs it; add it, do not use it) plus whatever the CLI pulls in (`lucide-react`, `class-variance-authority`, `tailwind-merge`, `@radix-ui/*`). Pin nothing by hand; let npm resolve. Commit the lockfile change in the same commit.

### 4. PWA
- `manifest.ts` (or `public/manifest.webmanifest`): `name` "Pluto", `short_name` "Pluto", `start_url` `/`, `display` `standalone`, background and theme colors, icons at 192x192 and 512x512 (generate simple PNGs, keep them small; an `any maskable` 512 is a bonus).
- `public/sw.js`: cache the app shell only. No API, no `/notes/*` PDF, no auth response may ever be cached — a stale or cross-student cached response is a security bug. Scope it to same-origin GETs for static assets, network-first or network-only for everything else, and bump a cache version constant.
    60|- Register it from a small client component (`pwa-register.tsx`) mounted in the `(app)` layout, guarded on `"serviceWorker" in navigator` and `process.env.NODE_ENV === "production"` so dev reloads stay sane.
- `proxy.ts` already treats `/manifest.webmanifest` and `/sw.js` as public; if you serve the manifest from `app/manifest.ts` its path is `/manifest.webmanifest`, so that still holds. Do not edit `proxy.ts` — if you believe you must, tell the orchestrator.

### 5. States
Loading (`loading.tsx` or `Skeleton`) and error (`error.tsx`) boundaries for `(app)`, so the later screens inherit them.

## Acceptance checks (run them, paste the output in the PR)
```
npm run typecheck                 # exit 0
npm run lint                      # exit 0
npm test                          # 136+ passed, 0 failed
npm run build -w @pluto/web       # succeeds; /login and / listed
    70|```
Manual, with the dev server on port 3101 (use `curl.exe -i` in PowerShell, and a real browser at 390px width):
1. Signed out, `GET /` -> 307 to `/login?next=%2F`.
2. Sign in as `demo@pluto.test` from `/login?next=%2F` -> lands on `/`, nav visible, no horizontal scroll at 390px.
3. `/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dabc123` -> after sign-in the browser is at `/oauth/consent?authorization_id=abc123` (a 404 page is fine, the URL is what matters).
4. `next=https%3A%2F%2Fevil.example`, `next=%2F%2Fevil.example`, `next=%2F%5Cevil.example` -> all land on `/`, never off-site.
5. `/login?error=link` -> shows the expired-link message.
6. Signed in, visit `/login` -> redirected to `/`.
7. Sign out -> back at `/login`; `GET /` is a 307 to `/login?next=%2F` again.
8. `GET /manifest.webmanifest` -> 200 JSON with both icon sizes and `"display":"standalone"`; both icon URLs 200.
    80|9. Nav links point at `/chat`, `/notes`, `/grades`, `/deadlines`, `/settings/canvas`, `/sms-sim`.

## Contract items touched
No tool or endpoint shape changes. You consume: `OPEN_RESPONSE.invalidLocation` (`/login?error=link`) and the deep-link format `/notes/<fileId>?page=<n>` for nav targets. If you think the contract must change, **stop** and tell the orchestrator; the director edits `docs/plan.md` first.

## Rules
- Commit small, push after every commit (`git push -u origin agent/web-shell` the first time).
- Never commit `.env.local` or any secret. The service-role key is not allowed anywhere in this task: `lib/supabase/admin.ts` is off limits for you.
- Stay in the files listed above. Need something else: ask the orchestrator, do not reach outside.
- Your PR is labeled `security-review` (login and sessions) and gets a fresh reviewer before grokbot. Expect one fix round.

## PR body
    90|Use `.github/PULL_REQUEST_TEMPLATE.md`: summary, build step and contract items touched, real output tails for typecheck / lint / test / build, the merge-gate checkboxes, and a "How to UI-test (for grokbot)" section with the numbered manual steps above (login `demo@pluto.test`, password from `.env.example`).

When the PR is open, reply `DONE` with the PR URL.

## Director amendment (2026-11-14 07:20, fix round 2 for PR #23)
Scope additions, approved by the director (these count as files you own):
- `apps/web/test/**` and `apps/web/vitest.config.ts` (tests for the files above).
- `apps/web/proxy.ts`, only for: (a) `/offline.html` in `PUBLIC_FILE_PATHS`; (b) forwarding the request path to server components as described below.
- `apps/web/components/sign-out-button.tsx`, `apps/web/lib/clear-pluto-caches.ts`, `apps/web/app/(app)/{actions,error,loading}.tsx` (part of the shell).
- `apps/web/next-env.d.ts` is generated by Next and is NOT yours: it must be identical to `origin/agent/web` in the PR diff.

Remaining BLOCKING items to fix:
1. The `(app)` layout guard must keep the original page in `next`. A layout cannot read the URL, so: in `proxy.ts`, always set (overwrite, never append) a request header `x-pluto-path` = pathname + search on the request forwarded to Next (`NextResponse.next({ request: { headers } })`, keeping the existing Supabase cookie handling intact). In `(app)/layout.tsx`, read it with `headers()`, run it through `safeNext`, and `redirect("/login?next=" + encodeURIComponent(path))`. A client-sent `x-pluto-path` must never survive the proxy. Add a test for the URL-building helper (including a hostile header value falling back to `/`).
2. Restore `apps/web/next-env.d.ts` to the `origin/agent/web` version and do not commit changes to it.

Acceptance: signed-out `GET /grades?x=1` -> 307 to `/login?next=%2Fgrades%3Fx%3D1` (proxy); with the proxy redirect bypassed (unit test), the layout builds the same URL. typecheck, lint, test, build green; CI green on the new head.
