# Coder task: web-phone (`/settings/phone`)

Branch `agent/web-phone`, worktree `C:/Pluto-web-phone`, PR into **`agent/web`**. Port **3107**. Orchestrator: web. Build step 8 (SMS setup, UI half), director item 10 (2026-11-14). Model: Cursor `composer-2.5`.

The student proves they own a phone by texting a one-time code to Pluto. You build the page that shows the code. The assistant slice builds `POST /api/sms/link-code` and the inbound `LINK <code>` handler. You do not.

This PR does **not** get a `security-review` label: no service role, no webhook, no migration, and the page never writes `profiles.phone`.

## Read first
- `CLAUDE.md`, `orchestrations/files/BRIEF.md`, `orchestrations/plans/web.md`.
- `apps/web/AGENTS.md`: **this is Next 16, not the Next you know.** Read the relevant guides in `node_modules/next/dist/docs/` first.
- `profiles.phone` is E.164 or null (`profiles_phone_e164` in `supabase/migrations/20261113000100_schema.sql`). Students can `select` their own row. **Never update, upsert, or insert `profiles`.** The only writers of `phone` are the seed and, later, the assistant's SMS webhook. A foundation migration that limits profile updates to `name` is not on this branch yet, so a mistaken update would succeed. Do not issue one.
- **Never edit `packages/core/**`, `docs/plan.md`, `apps/web/app/api/**`, `apps/web/package.json`, or `apps/web/lib/env.ts`.** Do not create `/api/sms/link-code`. Canvas owns `settings/canvas`; do not touch it.

## Setup
```
npm install
npm run env:local -- --port 3107
npm run dev -w @pluto/web
```
Shared local Supabase is running and seeded. **Never `supabase db reset`, never `supabase start/stop`.** No migrations. Mocks: `PLUTO_LLM=mock`, `SMS_PROVIDER=simulator`. Login `demo@pluto.test` / `DEMO_STUDENT_PASSWORD` in `.env.example`. Stop the dev server when you are not using it.

## Files you own
- `apps/web/app/(app)/settings/phone/**`
- `apps/web/components/settings/phone/**`

## What to build
The route is inside `(app)`, so a signed-out visitor is already redirected to `/login` by the layout. Do not add a public proxy exception.

1. Server-render the page with `createClient()` from `lib/supabase/server.ts`. Read `profiles.phone` (and `name` if you want the heading) with `.eq("id", user.id)` where `user.id` is the session user. If the query errors, show an error state, not another student's row.
2. When `phone` is null, say the account is not linked yet. When it is set, show the number.
3. A "Get a link code" button that POSTs to `/api/sms/link-code` from the browser with the session cookie (`credentials: "same-origin"`) and an empty JSON object or no student id. The route, when it exists, authenticates the session itself.
4. If the response is JSON with a string `code`, show: `Text LINK <code> to <number>`. `<number>` is `process.env.SENDBLUE_FROM_NUMBER`, read on the server and passed as a prop. If that variable is missing or empty, say "the Pluto number". Do not invent a phone number, and do not make `lib/env.ts` require the variable.
5. If the body also has `expiresAt`, say the code expires in 15 minutes. Do not log the code.
6. If the response is 404 or 501, or the body has no `code`, show "Phone linking isn't available yet." Keep showing the current phone. Do not invent a code and do not add a dev fixture.
7. A 401 from the POST sends the user to `/login?next=%2Fsettings%2Fphone`.
8. Loading and error states. 390px, no horizontal scroll. Tailwind only, same visual language as `apps/web/components/grades/`. No `@/components/ui` (those files are not on this branch). The app nav does not link here yet; that link is a later task. The page must still work when opened directly.

## Acceptance checks (run them, paste the output in the PR)
```
npm run typecheck                 # exit 0
npm run lint                      # exit 0
npm test                          # existing tests passed, 0 failed
npm run build -w @pluto/web       # succeeds; /settings/phone listed
```
Manual, dev server on 3107, browser at 390px, signed in as `demo@pluto.test`:
1. `/settings/phone` shows the demo student's phone, or "not linked" if `profiles.phone` is null. It does not show `other@pluto.test`'s phone.
2. Clicking "Get a link code" while `/api/sms/link-code` is missing shows "Phone linking isn't available yet", and the phone line stays. No fake code.
3. In the network tab the POST body does not contain a student id.
4. No horizontal scroll at 390px.
5. `git diff agent/web...HEAD --stat` shows only the owned paths. `git log -p` on your branch contains no `update(` on `profiles` and no service-role import.

## Contract items touched
Director decision 2026-11-14: `/settings/phone` displays a code from `POST /api/sms/link-code` and the linked `profiles.phone`. No zod schema for the link-code response exists yet. Expect `{ code: string, expiresAt?: string }`. If the assistant later ships a different shape, the orchestrator will send a follow-up. Do not edit `contract.ts`.

## Rules
- Commit small, push after every commit (`git push -u origin agent/web-phone` the first time).
- **Open the PR and stop. Never merge it** (no `gh pr merge`, no local merge into `agent/web`, no push to `agent/web`). Grokbot reviews, UI-tests and merges every PR.
- Never commit `.env.local` or a secret. Never log a link code.
- Stay in the files listed above.

## PR
Use `.github/PULL_REQUEST_TEMPLATE.md`: summary, build step and contract items, real output tails, merge-gate checkboxes (`security-review` = no), and "How to UI-test (for grokbot)" with the numbered steps above. Say clearly that the code appears only after the assistant route exists, and that a missing route must show the unavailable message.

When the PR is open, reply `DONE` with the PR URL.
