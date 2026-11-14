# Coder task: crunch-plan (Claude, sonnet): idea 5, proactive hook

Branch `agent/crunch-plan`, worktree `C:/Pluto-crunch-plan`, based on `agent/mcp-demo`, PR into `agent/mcp-demo`. Port 3603. No migrations. Security-sensitive (SMS inbound processing): label `security-review`. Shared brief: `orchestrations/files/BRIEF-mcp-demo.md`.

## Demo this enables
The demo button sends: `Pluto: your heaviest week is Nov 16-Nov 22: 3 things due worth 35% of your grades. ... Want a plan? Reply YES.` The student replies `yes`. Pluto texts back a short day-by-day plan for that week, built by the same agent and tools, with a magic link to the notes page for the first item.

## Contract (read first; it wins over this file)
`docs/plan.md`: the `/api/alerts/demo` and `/api/sms/inbound` rows and the last decision-log row. No new endpoint, field or table.

## Files you own
- `apps/web/lib/alerts-demo.ts` (`crunchMessage` only) and its tests (`apps/web/lib/alerts.test.ts`, `alerts-db.test.ts`).
- `apps/web/lib/sms-inbound.ts` (one hook in `processInboundSms`) and `apps/web/lib/sms-inbound.test.ts`.
- `apps/web/lib/crunch-plan.ts` (new) and its tests: the YES matcher, the latest-alert lookup, the plan request text.
- `packages/agent/src/mock.ts` (one small branch) plus a new `packages/agent/src/plan.ts` for the mock plan logic, and new tests in a new file under `packages/agent/test/`. PR #58 (`agent/chat-clarify`, not merged) also edits `mock.ts`, `gemini.ts` and `test/agent.test.ts`: keep your `mock.ts` edit to a few lines and don't touch `gemini.ts` or `agent.test.ts`.

Not yours: `packages/core/**`, `packages/mcp/**`, the webhook route and its secret check, `/sms-sim` UI, `apps/web/app/**`.

## Build
1. **Alert text.** `crunchMessage` keeps today's facts and calendar link and ends with `Want a plan? Reply YES.` The "nothing is due" text does not ask.
2. **Reply hook** in `processInboundSms`, after the student is found by phone and the inbound text is recorded (LINK codes and unknown numbers are unchanged and run first):
   - YES-style means the whole trimmed text matches, case-insensitive, with optional trailing `.`/`!`: `y`, `yes`, `yeah`, `yep`, `yup`, `sure`, `ok`, `okay`, `please`, `plan`, `yes please`, `sure thing`.
   - Look up that student's latest `crunch_week` alert with `sent_at` not null (`student_id = studentId` explicitly, newest `sent_at` first, one row). Use it only when `sent_at` is within the last 24 hours and `week_start` is set.
   - Then the agent message is a plan request the server builds from the alert row (never from the text): ask for a short day-by-day study plan for the week `week_start` to `week_start + 6 days`, using `get_deadlines` for what is due that week and `search_notes` for the notes on each item, short enough for a text.
   - Otherwise (not YES-style, no alert, too old) the message goes to the agent unchanged, exactly as today.
   - The rest is unchanged: same `runAgent`, same timeout, magic link from the first citation, same reply path.
3. **Mock agent** (`PLUTO_LLM=mock`, used in the keyless demo and tests): a study-plan request calls `get_deadlines` (and `search_notes` for the first item so there is a citation) and returns a deterministic plan: one line per day, items ordered by due date, each with course and due time. Under ~600 characters. The Gemini path needs no code change; check that the request text works with the SMS system prompt as written.

## Acceptance checks (prove each in the PR body)
- Unit: YES matcher (accepts the list, rejects `yes but what about grades`, `no`, `LINK ABC123`); the plan-request builder (dates from the alert row); `crunchMessage` with and without a week.
- DB tests with the simulator provider and `PLUTO_LLM=mock`: (a) demo alert sent -> inbound `YES` from the student's phone -> the reply is a plan for that alert's week and an outbound `sms_messages` row exists; (b) `YES` with no alert, or an alert sent 25 hours ago -> normal agent path; (c) another student's recent alert never triggers a plan for this student; (d) LINK codes still work.
- Live: build, start on 3603 in the background, sign in as the demo student, POST `/api/alerts/demo` (session cookie or `x-internal-secret`), then send `yes` from `/sms-sim` (or call its server action path) and show both texts from `sms_messages`. Stop the server.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build -w @pluto/web` pass.
