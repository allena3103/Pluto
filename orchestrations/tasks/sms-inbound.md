# Coder task: sms-inbound (Claude, opus)

Branch `agent/sms-inbound`, worktree `C:/Pluto-sms-inbound`, based on `agent/pluto`, PR into **`agent/pluto`**. Port 3404. Migration range `20261114041000`-`20261114041959`. Security-sensitive: labeled `security-review`, a fresh reviewer runs before merge.

Read `CLAUDE.md`, `orchestrations/files/BRIEF.md`, `orchestrations/plans/director.md`, `apps/web/AGENTS.md` (Next 16), then the sections `### assistant-sms (after sync)` and "Shared design" in `orchestrations/plans/assistant.md`. Build that section exactly, with these changes:
- The F2 sync is done. `sendSms`, `recordInboundSms`, `findStudentByPhone` and `normalizePhone` are in `@pluto/core/sms`. `consumeLinkCode` is in `apps/web/lib/phone-link.ts`. `runAgent` is in `@pluto/agent`. `apps/web/lib/sms-magic-link.ts` already calls `createMagicLink`. Don't replace it; another coder (`open-links`) may add an ownership check to it, so you only call it.
- Reuse the internal-secret / timing-safe compare helper that `apps/web/app/api/agent/reply` uses, if it is shared. For the Sendblue secret, follow Sendblue's current webhook docs (put the URL in a comment).
- Ignore the Cursor/model and grokbot lines.
- The `/sms-sim` "crunch week" button may POST `/api/alerts/demo`, which doesn't exist yet. Ship the button anyway.

## You own
`apps/web/app/api/sms/inbound/**`, `apps/web/app/(app)/sms-sim/**`, `apps/web/components/sms-sim/**`, `apps/web/lib/sms-inbound.ts` and its tests, one migration `supabase/migrations/20261114041000_sms_inbound_receipts.sql`. Add a "SMS" nav link to `/sms-sim` in the app shell nav component (one line). Do not edit `packages/core/**`, `packages/agent/**`, `contract.ts`, `docs/plan.md`, `proxy.ts`, or the lockfile.

## Migration rules
RLS on, no policies, `revoke all ... from public, anon, authenticated`, `grant all ... to service_role`, end with `notify pgrst, 'reload schema';`. Copy the posture of `20261114040000_phone_link_codes.sql`. Then add the new table to the table list in `packages/core/test/db/rls.test.ts` ("covers every public table"); that one-line test edit is allowed. Apply it locally with `npx supabase migration up` (never `db reset`).

## Acceptance
The section's acceptance list, as permanent tests where they're cheap (duplicate delivery doesn't send twice; wrong secret is 401 with no lookup; unknown number creates no profile and no `sms_messages` row; `LINK <code>` sets `profiles.phone`; a linked-number question with `PLUTO_LLM=mock`, `SMS_PROVIDER=simulator` stores an outbound row ending in an `/open/` URL). Manual: `/sms-sim` at 390px as `demo@pluto.test`, from a background server you stop afterwards.

## Delivery
`npm run typecheck`, `npm run lint`, `npm test`, `npm run build -w @pluto/web` once at the end. Commit small, push after every commit. `gh pr create --base agent/pluto --head agent/sms-inbound --title "SMS: inbound webhook, LINK codes, /sms-sim"`. The body lists the contract items, the migration, check tails, and "How to UI-test". Add the label: `gh pr edit <n> --add-label security-review`. Reply `DONE <PR URL>` and go idle. If anything needs a decision, describe it and go idle.
