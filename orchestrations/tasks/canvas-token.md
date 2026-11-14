# Coder task: canvas-token

Branch `agent/canvas-token`, worktree `C:/Pluto-canvas-token`, base and PR target `agent/canvas`. Build step 10 (live Canvas sync), the credentials half. Port 3202. Migrations: none — do not add any.

You are a Cursor coder. Read `CLAUDE.md` (including "Allen's global rules"), `orchestrations/files/BRIEF.md` and `orchestrations/plans/canvas.md` first. Follow them.

**This PR is security-sensitive** (Canvas token encryption + an authenticated write route). The orchestrator labels it `security-review` and runs a fresh reviewer before grokbot merges. Write it as if a stranger will read every line, because one will.

## Goal
A student can paste a Canvas personal access token and base URL at `/settings/canvas`, and it is stored encrypted at rest in `profiles.canvas_token_encrypted`. The plaintext token and the ciphertext never come back out to any client.

## You own (edit nothing else)
- `packages/canvas/src/token-crypto.ts`
- `packages/canvas/test/token-crypto/**`
- `apps/web/app/api/canvas/token/route.ts`
- `apps/web/app/(app)/settings/canvas/**` (server page + a client component in the same folder)

Not yours, do not touch: `packages/canvas/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `test/setup.ts`, `test/db-env.ts`, `packages/core/**`, `apps/web/lib/**`, `apps/web/components/**`, `apps/web/app/(app)/layout.tsx`, `supabase/**`, `scripts/**`, root configs, `package-lock.json`, `docs/plan.md`, `.env.example`. Need a dependency or a change outside your files: stop and reply to the canvas orchestrator; do not edit it yourself.

`apps/web/components/**` belongs to the web slice and shadcn/ui is not installed yet, so build the page with plain Tailwind markup inside your own folder. Do not add shared components.

## Contract items touched
No contract schema. You write `profiles.canvas_token_encrypted` and `profiles.canvas_base_url` (`supabase/migrations/20261113000100_schema.sql`). `/api/canvas/token` is an internal convenience route that is not in `docs/plan.md`'s ten endpoints: keep its shape minimal and documented in the PR body so the director can log it.

## What to build

### `token-crypto.ts` (no Supabase, no I/O)
- `encryptCanvasToken(plaintext: string, keyB64?: string): string` and `decryptCanvasToken(payload: string, keyB64?: string): string`, AES-256-GCM via `node:crypto` (`createCipheriv`/`createDecipheriv`, `aes-256-gcm`).
- Key from `CANVAS_TOKEN_KEY` (base64) when `keyB64` is not passed. It must decode to exactly 32 bytes; anything else throws a clear error that does **not** include the key or any part of it. Missing key throws too — never fall back to a built-in key.
- Fresh random 12-byte IV per call (`randomBytes`), so encrypting the same token twice gives different output.
- Payload format `v1.<ivB64url>.<tagB64url>.<ciphertextB64url>`. Reject a payload with the wrong prefix, wrong part count or bad base64 before touching the cipher.
- A tampered ciphertext, tag or IV makes `decryptCanvasToken` throw (GCM auth failure) and never return partial plaintext.
- `isEncryptedCanvasToken(value: string): boolean` for cheap shape checks.
- Export `CANVAS_TOKEN_KEY_BYTES = 32`. Never log, never `console.log` a token, a key or a payload.

### `POST /api/canvas/token`
- `export const runtime = "nodejs"` (node:crypto) and a `maxDuration`.
- Auth first: the student's own session through `createClient()` from `@/lib/supabase/server` and `auth.getUser()`. No user -> 401 before any other work. **No service-role client in this route at all**; the write goes through the student's session client so RLS (`profiles_update_own`) is the second line of defence.
- Body validated with a small zod schema: `token` trimmed, 20-200 chars, no whitespace inside; `baseUrl` must parse as a URL, be `https:`, have a hostname, and have no path beyond `/`, no query and no fragment (store the normalised `https://host` form). Bad input -> 400 with a message that does not echo the token.
- Writes `canvas_token_encrypted` (from `encryptCanvasToken`) and `canvas_base_url` with `.eq("id", user.id)`, and returns exactly `{ connected: true, baseUrl }`.
- `DELETE` clears both columns for the signed-in student and returns `{ connected: false, baseUrl: null }`.
- `GET` returns exactly `{ connected: boolean, baseUrl: string | null }` — derive `connected` from whether the column is non-empty, server-side. The ciphertext never appears in a response body.
- Wrap the Supabase calls so a failure is a 500 with a generic message; no stack traces or token fragments in the response.

### `/settings/canvas`
- Server component: reads the connection state with the session client (the `(app)` layout already redirects signed-out users to `/login`), and renders the current state ("Connected to umamherst.instructure.com" / "Not connected").
- A client component in the same folder with the form: a password-type token input (so it is not shown or autofilled into history), a base-URL input defaulting to `https://umamherst.instructure.com`, a save button with pending and error states, and a "Disconnect" button that calls `DELETE`. After a successful save, refresh the server state (`router.refresh()`); do not keep the token in React state longer than the submit, and clear the input afterwards.
- Mobile first: usable at 390px width with no horizontal scroll. Plain Tailwind, consistent with `apps/web/app/(app)/layout.tsx`'s look (slate text, white background, rounded borders).
- Say plainly on the page what the token is used for and that it is stored encrypted. Link nothing external.

## Acceptance checks (paste the real output tails in the PR body)
From `C:/Pluto-canvas-token` after `npm install` and `npm run env:local -- --port 3202`:
1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build -w @pluto/web` all green.
2. Unit tests (no DB) for: round-trip; the same input encrypting to two different payloads; a wrong key fails to decrypt; a flipped byte in the ciphertext throws; a flipped byte in the tag throws; a 16-byte key throws; a missing `CANVAS_TOKEN_KEY` throws; `isEncryptedCanvasToken` accepts a real payload and rejects plaintext; no thrown error message contains the token or the key (use a distinctive fake token like `canvas-token-DO-NOT-LEAK`).
3. With the dev server on 3202, paste `curl -i` output for:
   - `POST /api/canvas/token` with no cookies -> 401 and no row written;
   - `POST` with a signed-in session and a bad `baseUrl` (`http://x`, or one with a path) -> 400;
   - `POST` with a valid body -> 200 `{"connected":true,...}`;
   - `GET` -> `{"connected":true,"baseUrl":"..."}` with no ciphertext;
   - `DELETE` -> `{"connected":false,"baseUrl":null}`.
   Get the session cookie by logging in as `demo@pluto.test` in a browser, or with a small `curl` sign-in against the Supabase auth endpoint — say which you did.
4. Proof the token does not leak, with the command and its output:
   - `psql "$SUPABASE_DB_URL" -c "select canvas_token_encrypted from profiles where id = '11111111-1111-4111-8111-111111111111'"` shows a `v1.` payload, and `grep` for the plaintext token in that output finds nothing;
   - after `npm run build -w @pluto/web`, a recursive grep for the plaintext token and for `CANVAS_TOKEN_KEY` in `apps/web/.next` finds nothing;
   - the dev-server log for the requests above contains no token.
   Use a throwaway token value for all of this, never `CANVAS_API_TOKEN` from `.env.local`.
5. A screenshot or a 390px-wide browser description of `/settings/canvas` in both states (connected and not), and the "How to UI-test" steps for grokbot.

## Process
- Local Supabase is shared and running: never stop it, never `supabase db reset`.
- Commit small, `git push -u origin agent/canvas-token` after every commit.
- Stop the dev server as soon as a check is done; memory is tight and other agents are running.
- Open a PR into `agent/canvas` using `.github/pull_request_template.md` with the sections above filled in from real output.
- CI (`check`) must be green before you reply DONE; check with `gh pr checks <pr>`. Grokbot merges, you never merge.
- Reply `DONE <PR URL>` when the PR is open and CI is green. Blocked or needing a file you do not own: reply `BLOCKED:` with what you need.
