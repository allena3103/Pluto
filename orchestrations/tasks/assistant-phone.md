# Coder task: assistant-phone

Branch `agent/assistant-phone`, worktree `C:/Pluto-assistant-phone`, base and PR target `agent/assistant`. Port 3402. Migration range `20261114040000`-`20261114040959`. Use `20261114040000` only.

You are a Cursor coder on `grok-4.7-high`. Follow `CLAUDE.md`, `orchestrations/files/BRIEF.md`, and `orchestrations/plans/assistant.md`. This is decision-log item "Phone linking" (2026-11-14) and item 9 of `orchestrations/files/40-assistant.md`. The endpoint is not in `contract.ts` `ENDPOINTS`. Do not edit `packages/core/**`, `docs/plan.md`, or `contract.ts`. A local zod schema is the contract for this route until the director adds one.

The shared Supabase stack is already running. Apply your migration with `npx supabase migration up`. Never `supabase db reset`. Never stop or restart the stack. Docker is at `C:\Program Files\Docker\Docker\resources\bin` if `docker` is not on `PATH`.

## Goal
A signed-in student can mint a 6-character code. Later, SMS inbound (a different task) will call `consumeLinkCode` when the text is `LINK <code>`. This task does not build the webhook.

## You own
- `supabase/migrations/20261114040000_phone_link_codes.sql`
- `apps/web/lib/phone-link.ts`
- `apps/web/lib/phone-link.test.ts`
- `apps/web/app/api/sms/link-code/route.ts`

Edit nothing else. No lockfile change. No new dependency. Do not edit `packages/core/src/database.types.ts`. The new table is absent from that file on purpose.

## Migration
`phone_link_codes`:

- `id uuid primary key default gen_random_uuid()`
- `student_id uuid not null references public.profiles (id) on delete cascade`
- `code_hash text not null unique` (SHA-256 hex of the code; the raw code is never stored)
- `expires_at timestamptz not null`
- `used_at timestamptz`
- `created_at timestamptz not null default now()`
- index on `student_id`

RLS on. No policies. `revoke all` from `public`, `anon`, and `authenticated`. `grant all` to `service_role`. End with `notify pgrst, 'reload schema'`. Same posture as `magic_links`: the service role bypasses RLS; signed-in students have no grant and no policy.

## Library (`apps/web/lib/phone-link.ts`)
This is the only file that may unsafely widen the Supabase client so it can name `phone_link_codes`. Keep the cast inside this file. `profiles` updates use the typed client.

Alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, length 6. Hash is SHA-256 hex of the trimmed, uppercased code. TTL `15 * 60 * 1000`. Export `LINK_CODE_TTL_MS`.

`normalizePhone(phone: string): string | null`. Match the foundation helper that will arrive later, so the two agree:

- trim
- if it starts with `+`, keep a leading `+` and the digits
- otherwise strip non-digits; 10 digits become `+1` plus those digits; 11 digits starting with `1` become `+` plus those digits
- accept only `^\+[1-9]\d{6,14}$`, else `null`

`createLinkCode(admin, studentId) -> Promise<{ code: string; expiresAt: string }>`:

- `expiresAt` is ISO 8601 with an offset (`toISOString()` is fine)
- retire this student's unused rows first (`used_at` set to now where `student_id` matches and `used_at` is null)
- insert the hash, not the code
- return the plaintext code once. Callers must not log it

`consumeLinkCode(admin, rawCode, fromNumber) -> Promise<{ ok: true; studentId: string } | { ok: false; reason: "invalid" | "phone_taken" }>`:

- Normalize the code (trim, uppercase). If it is not 6 alphabet characters, return `invalid` and do not burn anything.
- Normalize `fromNumber`. If that returns null, return `invalid` and do not mark a code used.
- Find the active row by hash (`used_at` is null and `expires_at` is in the future). No such row: `invalid`. Do not reveal whether it was missing, used, or expired.
- If some other profile already has this E.164 phone, mark this code used and return `phone_taken`. Change neither profile.
- Otherwise one conditional update: set `used_at` where the id matches, `used_at` is null, and `expires_at` is still in the future, and return the student id. Zero rows means a race: `invalid`.
- Then set `profiles.phone` for that student. Replacing that same student's old number is allowed. A unique-violation from a concurrent claim is `phone_taken`.
- The inbound task sends the SMS text. This function does not.

Export all three functions.

## Route
`POST /api/sms/link-code`:

- `createClient()` from `@/lib/supabase/server`, then `getUser()`. No user, or an auth error: 401 JSON `{ error: "unauthorized" }` and do not construct the admin client.
- The student id is the session user id. Ignore any body.
- Then `createAdminClient()` from `@/lib/supabase/admin` and `createLinkCode`.
- 200 `{ code, expiresAt }`. `expiresAt` must parse as an ISO timestamp with an offset.
- Local zod for the response only. No `studentId` field.
- Do not log the code. Do not put it in an error message.

Keep the route thin. If `cookies()` makes the route hard to call from Vitest, export a function `issueLinkCode({ userId, create })` from `phone-link.ts` that returns `{ status: 401 }` or `{ status: 200, code, expiresAt }` and have the route call it. The test covers that function.

## Tests
`apps/web/vitest.config.ts` already includes `lib/**/*.test.ts`. Stay in that file. Load `apps/web/.env.local` with `dotenv` if the variables are missing (root devDependency). Copy the skip gate locally (do not import `packages/core/test/**`, it is not a public export):

- `PLUTO_SKIP_DB_TESTS=1` skips the database cases
- otherwise missing `NEXT_PUBLIC_SUPABASE_URL`, anon key, or service role key throws

Create throwaway auth users with unique emails and delete them in `afterAll` (read `packages/core/test/db/helpers.ts` for the pattern; do not edit it). Run `npm run env:local -- --port 3402` once so `.env.local` exists. Do not leave a dev server running.

Assert:

- `createLinkCode` returns a 6-character alphabet code. The row's `code_hash` equals the SHA-256 hex of that code and does not contain the code.
- A second `createLinkCode` for the same student leaves only one unused row.
- `consumeLinkCode` sets `profiles.phone` to the normalized number and sets `used_at`.
- A second consume of the same code returns `invalid` and does not change the phone.
- A code whose `expires_at` you set in the past returns `invalid`.
- A wrong code returns `invalid`.
- When the number already belongs to another throwaway student, the result is `phone_taken`, the code is used, and both phones are unchanged.
- The same student may replace their own phone.
- An authenticated client (anon key + that user's session) cannot select `phone_link_codes` (empty or error, never the hash).
- `issueLinkCode` with `userId: null` is status 401 and does not call `create`.

`normalizePhone("+1 (413) 555-0123")` is `+14135550123`. A 10-digit number gains `+1`. `"not-a-phone"` is null.

## Acceptance
From `C:/Pluto-assistant-phone`, with the migration applied:

- `npm run typecheck`
- `npm run lint`
- `npm test` (database cases actually run; say so in the PR)
- `PLUTO_SKIP_DB_TESTS=1 npm test`

Paste the real tails. The PR is security-sensitive (migration, RLS, service role, `profiles.phone`). You do not add the label and you do not merge. The orchestrator labels `security-review` and runs the fresh reviewer.

## Process
Commit small. `git push -u origin agent/assistant-phone` after every commit. PR into `agent/assistant` with `.github/pull_request_template.md`.

PR body: decision-log phone linking; no `contract.ts` change and why; check tails; how to UI-test. UI-test for grokbot: sign in as `demo@pluto.test` (password in `.env.example`), `POST /api/sms/link-code` with the session cookie, expect 200 and a 6-character `code`. A signed-out POST returns 401. There is no settings page in this slice (web owns `/settings/phone`).

Reply `DONE` and the PR URL.
