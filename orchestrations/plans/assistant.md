# Assistant plan

Orchestrator: assistant (Cursor planner, `grok-4.7-high`). Branch `agent/assistant`, worktree `C:/Pluto-assistant`, port 3400, migrations `20261114040000`-`20261114045959`.
Build steps: 5 (agent loop and `/api/chat` + `/api/agent/reply`), 8 (SMS), 9 (alerts + ICS), plus the 2026-11-14 phone-linking item.
Contract: `docs/plan.md` (decision log through the shared-web-config edit) and `packages/core/src/contract.ts`. They already agree on the ten endpoints, NDJSON `/api/chat` (`text`, `citation`, `done`, `error`, content type `application/x-ndjson`), and header `x-internal-secret`. Do not edit either file.

## What this branch already has
`agent/assistant` is `agent/pluto` at F1 plus the 7 core tool functions (`TOOL_HANDLERS` in `@pluto/core/tools`). Schema, RLS, seed ids, the web shell, and `contract.ts` are here. Ingest has not filled `file_pages` on this branch; tests that need a citation inject a fake tool result or insert their own rows. They do not depend on synthetic PDFs.

## What is not here yet
`createMagicLink`, `sendSms`, `recordInboundSms`, `findStudentByPhone`, `normalizePhone`, `buildIcs`, `getCalendarFeed`, `newFeedToken`, and `calendarFeedUrl` live on `agent/foundation` and land via a sync PR after foundation's F2 milestone merges into `agent/pluto` (PROTOCOL 2e). Until that sync:

- Do not edit `packages/core/**` (including `database.types.ts` and `src/index.ts`).
- Do not import `@pluto/core/magic-links`, `@pluto/core/sms`, or `@pluto/core/ics`. Those modules are not on this branch and an import will fail typecheck.
- Build `packages/agent` and the routes against `contract.ts` and `TOOL_HANDLERS`.

Expected imports after the sync (from the foundation-helpers task; if the merged modules differ, follow the merged exports):

- `createMagicLink(admin, { studentId, fileId, page, appUrl, now? }) -> { url, token, expiresAt }`
- `sendSms(deps, { studentId, to, body }) -> { ok, provider, id } | { ok: false, provider, error }` (`deps`: `{ admin, provider?, env?, fetch? }`)
- `recordInboundSms(admin, { studentId, from, body, provider })`
- `findStudentByPhone(admin, phone)`, `normalizePhone(phone)`
- `buildIcs({ calendarName, events, now? })`, `getCalendarFeed(admin, feedToken)`, `newFeedToken()`, `calendarFeedUrl(appUrl, token)`

`sendSms` requires a `studentId`. An unknown sender has none; the SMS task sends that one polite reply without inserting an `sms_messages` row.

## Models, mocks, keys
- Default Gemini model: `gemini-4-hydrogen`. Google's current everyday agent model (added to `@google/genai` on 2026-11-12). The agent coder confirms it against `https://ai.google.dev/gemini-api/docs/models` and uses that page's recommended starting model id if it differs. Do not use `gemini-2.5-*` (deprecated) or a preview alias the v1 API rejects.
- Function calling uses the current Interactions API (`client.interactions.create`, `store: false`). The sample model in Google's function-calling page is not our default. Append the SDK's step objects unchanged so any signature fields survive the next turn.
- Real `GEMINI_API_KEY` and Sendblue keys are in `C:/Pluto/.env.secrets`. `npm run env:local` copies them into `apps/web/.env.local`. Never commit that file, never print a key, never put a key in a test.
- `npm test` and CI use `PLUTO_LLM=mock` and `SMS_PROVIDER=simulator`. Unit tests pass `llm: "mock"` (or the fake Gemini client) so a developer env cannot hit the network. A live Gemini check is the orchestrator's, once `/api/chat` is merged, and is reported in the milestone. A real phone round trip stays pending until Allen texts the sandbox number.

## Memory and spawn
16 GB machine. Check free memory before every spawn:

`powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB"`

Under 2 GB free: one coder, and no reviewer until that coder is idle. At or over 2 GB: at most two coders. Reviewers one at a time, on `grok-4.7-high`. Never leave `npm run dev` or `next dev` running.

Cursor coders: `herdr agent start --kind cursor -- --force --trust --model <model>`. Account via `${CURSOR_API_KEY:+--env CURSOR_API_KEY=$CURSOR_API_KEY}` only. Never write the key into the repo.

Grokbot merges every PR. This orchestrator never merges. Security PRs (below) get a fresh reviewer first (PROTOCOL 4, model from 2b: `grok-4.7-high`, not `gpt-5.3-codex`).

## Shared design
- Page numbers are 1-based. Deep links are absolute `/notes/<fileId>?page=<n>` from the tool results (`noteUrl`). SMS `deepLink` is a one-time `/open/<token>` URL, and only after the sync wires `createMagicLink`.
- `/api/chat` uses the signed-in user's Supabase client (RLS on) and still filters by `student_id`. `/api/agent/reply`, link-code inserts, SMS inbound, alerts demo, and the ICS feed use the service-role client only after the route has verified its secret, session, or token. Every query filters by `student_id` except lookup-by-secret (link-code hash, feed token, magic-link token).
- Compare `INTERNAL_API_SECRET` and the Sendblue webhook secret by SHA-256 of both sides, then `timingSafeEqual`. Do that before constructing the admin client.
- `phone_link_codes` is not in `database.types.ts`. Do not edit that file. The phone helper talks to the table through one cast confined to `apps/web/lib/phone-link.ts`.
- `/api/sms/link-code` is specified in the decision log and task item 9, and it is not in `ENDPOINTS`. Do not edit `contract.ts`. A local zod schema in the route is enough; the director can add the contract schema later.
- Students cannot update `profiles.phone` (column grant + trigger). Only the service role, from the LINK handler, writes it. No other new writer.
- One citation pair fits on `chat_messages` (`cited_file_id`, `cited_page`). Persist the first citation. The NDJSON stream still emits every citation.
- Lockfile: a task that adds a dependency runs `npm install` from the repo root and lists the lockfile in the PR body. No hand-edits. No two tasks may `npm install` at the same time.
- Web chat UI, `/login`, `/open`, and `/settings/phone` belong to the web slice. This slice serves the APIs and `/sms-sim`.

## Tasks

| Task | Model | When | Owns | Migration | Port | Security review |
| --- | --- | --- | --- | --- | --- | --- |
| `assistant-agent` | `grok-4.7-medium` | now | `packages/agent/**`, lockfile via `npm install`, `GEMINI_MODEL` line in `.env.example` | none | 3401 | no |
| `assistant-phone` | `grok-4.7-high` | now if free memory ≥ 2 GB, else when the agent coder is idle | `supabase/migrations/20261114040000_phone_link_codes.sql`, `apps/web/lib/phone-link.ts`, `apps/web/lib/phone-link.test.ts`, `apps/web/app/api/sms/link-code/**` | `20261114040000`-`20261114040959` | 3402 | yes |
| `assistant-routes` | `grok-4.7-high` | after `assistant-agent` has merged into `agent/assistant` | `apps/web/app/api/chat/**`, `apps/web/app/api/agent/**`, `apps/web/lib/chat-handler.ts`, `apps/web/lib/agent-reply.ts`, `apps/web/lib/sms-magic-link.ts`, their tests, one `@pluto/agent` dependency in `apps/web/package.json` + lockfile | none | 3403 | yes (`/api/agent/reply`) |
| sync | orchestrator | when `origin/agent/pluto` contains the F2 helpers | PROTOCOL 2e: branch `agent/assistant-sync` off `agent/assistant`, merge `origin/agent/pluto`, take theirs for files this slice does not own, keep our files, checks, PR into `agent/assistant` | none | 3400 | no, unless the merge itself edits a security file we own |
| `assistant-sms` | `grok-4.7-high` | after routes, phone, and the sync have merged | `apps/web/app/api/sms/inbound/**`, `apps/web/app/(app)/sms-sim/**`, `apps/web/components/sms-sim/**`, `apps/web/lib/sms-inbound.ts` + test, replace the body of `sms-magic-link.ts`, dedupe migration | `20261114041000`-`20261114041959` | 3404 | yes |
| `assistant-alerts` | `grok-4.7-high` | after the sync; parallel with SMS only if memory allows and the SMS coder is not in `sms-magic-link.ts` | `apps/web/app/api/alerts/demo/**`, `apps/web/app/cal/**`, `apps/web/lib/alerts-demo.ts`, `apps/web/lib/cal-feed.ts`, their tests. May add `ical.js` as a devDependency of `@pluto/web` | `20261114042000`-`20261114042959` (expect none) | 3405 | yes |

No file is owned by two tasks. `sms-magic-link.ts` is created by routes (returns `null`) and its body is replaced by SMS after the sync.

### assistant-agent
`packages/agent` (`@pluto/agent`). One `runAgent` used later by web chat and SMS.

```ts
runAgent({
  message, channel, ctx?, runTool?, history?,
  createMagicLink?, llm?, model?, signal?,
}): Promise<{ text: string; citations: { fileId, page, deepLink }[]; magicLinkUrl?: string }>
```

- Declarations come from `TOOLS` in `@pluto/core/contract` (Zod 4 `z.toJSONSchema`). Names match the 7 tools. `create_magic_link` is added only when `createMagicLink` is passed. Its args are `{ fileId, page }`. The student id always comes from the host, never from the model.
- Default runner calls `TOOL_HANDLERS` with `ctx`. Tests inject `runTool` and do not touch the database.
- `PLUTO_LLM` defaults to `mock` when unset. Mock is a deterministic script: grades / deadlines / crunch / courses / otherwise `search_notes`. One tool round. Citations are copied from tool JSON that carries `fileId`, `page`, and `deepLink` (including nested `pages` and `results`). SMS text is plain, under 300 characters, and does not invent a URL. When `channel` is `sms` and a citation exists and `createMagicLink` is set, call it and set `magicLinkUrl`.
- Gemini path: `@google/genai`, model `process.env.GEMINI_MODEL` or `gemini-4-hydrogen`, `store: false`, max 4 tool rounds, 10s per tool, 20s per model call. Tool errors go back as a short function result, not a stack. Unknown tool names get an error result. After the cap or a timeout, return whatever text and citations were collected, or one safe sentence. Never throw past `runAgent`.
- System prompt: Pluto is the student's academic assistant; use tools for notes, grades, deadlines, and courses; never invent a page or a link; pages are 1-based; SMS replies stay short because the app appends the magic link.

Acceptance: `npm run typecheck && npm run lint && npm test` green. A mock "where are my notes about the treaty" run against a fake `search_notes` returns that file id, a page ≥ 1, and a deep link that `DeepLink` accepts. A fake Gemini client that returns one function call then text is asserted without any network. `PLUTO_LLM=gemini` is not required for the PR.

### assistant-phone
Migration `20261114040000_phone_link_codes.sql`: `student_id`, `code_hash` (SHA-256 hex, unique), `expires_at`, `used_at`, `created_at`. RLS enabled, no policies, `revoke all` from `public`/`anon`/`authenticated`, `grant all` to `service_role`, `notify pgrst, 'reload schema'`. Apply with `npx supabase migration up`. Never `db reset`, never stop the shared stack.

`apps/web/lib/phone-link.ts` (the only file that may cast the client to reach this table):

- Alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, length 6. Store only the hash of the trimmed uppercased code. TTL 15 minutes. Creating a code retires that student's unused codes (`used_at = now()`) first.
- `consumeLinkCode(admin, rawCode, fromNumber)` looks up the hash, then one conditional update (`used_at is null` and `expires_at > now`). Unknown, used, expired, and a malformed number all return `{ ok: false, reason: "invalid" }` with no difference between those cases. A malformed number does not burn the code. If the E.164 number already belongs to a different student, mark this code used, change neither phone, and return `{ ok: false, reason: "phone_taken" }`. Replacing the same student's previous phone is allowed. A replay of a used code is `invalid`.
- On success set `profiles.phone` to that E.164 number (same rules as foundation's `normalizePhone`: strip spaces, dashes, parentheses; `+1` for 10 digits; reject anything that fails `^\+[1-9]\d{6,14}$`) and return `{ ok: true, studentId }`.
- Export `normalizePhone` from this file until the sync; the SMS task switches to `@pluto/core/sms` after that.

`POST /api/sms/link-code`: session required (401 otherwise). Student id is `auth.uid()`, never a body field. Response `{ code, expiresAt }` where `expiresAt` is an ISO timestamp with an offset. Call the admin client only after `getUser` succeeds. Do not log the code.

Acceptance: with the local stack, `npm test` shows a throwaway user getting a code whose row stores the hash and not the code; a second issue retires the first; consume sets that user's phone; a second consume is invalid; an expired code is invalid; a number owned by another user returns `phone_taken` and changes nothing; an authenticated (non-service) client cannot select the table. `PLUTO_SKIP_DB_TESTS=1 npm test` still passes. Route helper returns 401 when there is no user.

### assistant-routes
Depends on the merged agent package. Add `"@pluto/agent": "*"` to `apps/web/package.json` and `npm install` once.

`POST /api/chat` (session):

- 401 with no user. 400 when `ChatRequest` rejects the body. A `sessionId` that is missing or belongs to someone else is 404 (same response either way).
- Create the session when omitted (`channel: "web"`, `student_id` = the user). Insert the user message, run `runAgent` with the user client as `ctx.db`, `channel: "web"`, `llm` from `PLUTO_LLM` (default `mock`).
- Stream `application/x-ndjson`: one `ChatStreamEvent` per line, validated before write. Text may be one or more `text` deltas. Then one `citation` per citation. Then exactly one `done` with the session id, or exactly one `error` and nothing after it. Safe error text only.
- Persist the assistant message with the first citation's `cited_file_id` and `cited_page`.
- `appUrl` from `APP_URL`. Whole call bounded by 25s.

`POST /api/agent/reply` (internal):

- Verify `x-internal-secret` before the admin client. 401 on miss or mismatch. 400 on a bad body.
- Admin client, `studentId` from the body, passed into `makeToolContext`. Tools filter on it.
- `channel: "web"`: `deepLink` is the first citation's notes URL, omitted when there is none.
- `channel: "sms"`: call `createSmsMagicLink` in `apps/web/lib/sms-magic-link.ts`. This task's implementation returns `null` and must not import `@pluto/core/magic-links`. When it returns null, omit `deepLink`. When a test injects a creator that returns a URL, the reply text is the short answer, ends with that URL, and `deepLink` is that URL.
- Response parses as `AgentReplyResponse`.

Acceptance: mock chat stream for a message that the fake or scripted search path can cite contains a `citation` whose page is ≥ 1 and a `done` session id, and the assistant row stores that file and page. A second student cannot read the first student's session. Missing internal secret is 401 and does not require the database. Web `deepLink` matches `DeepLink`. SMS with an injected creator ends with the magic URL.

### assistant-sms (after sync)
`POST /api/sms/inbound`:

- Verify `SENDBLUE_WEBHOOK_SECRET` the way Sendblue's current webhook docs say (note the doc URL in a comment). Timing-safe compare. 401 before any student lookup.
- Idempotent: migration `20261114041000_sms_inbound_receipts` (`dedupe_key text primary key`, `created_at`), RLS on, service role only. Key is the provider message id when the payload has one, otherwise SHA-256 of `from_number + "\n" + content`. Insert-first; on conflict return `{ ok: true }` and do not send again.
- Body parses as `SmsInboundRequest` (extra keys kept).
- If `content` matches `/^LINK\s+([A-Za-z0-9]{6})\s*$/i`, call `consumeLinkCode`. Confirm on success ("Your phone is linked to Pluto."). On `phone_taken` or `invalid`, a polite fixed sentence. Do not run the agent.
- Otherwise `findStudentByPhone`. Unknown number: one polite fixed reply telling them to sign in and text `LINK` plus the code. Do not insert `sms_messages` (no student). Known number: `recordInboundSms`, `runAgent` with `channel: "sms"` and `createMagicLink` wired through `sms-magic-link.ts` to `createMagicLink`, then `sendSms`. The text is short and ends with the `/open/<token>` URL. `deepLink` on the agent reply is that URL.
- The simulator does not call the public webhook and does not see the webhook secret. `/sms-sim` (signed-in, mobile first, 390px, no horizontal scroll) posts through a server function that checks the session and then calls the same handler with `from_number` set from the form (so a LINK from a new number works) and the signed-in student only as the viewer of `sms_messages`. Replies render from `sms_messages`.
- A "crunch week" button on that page POSTs `/api/alerts/demo` with the signed-in student id. The button can ship in this task; the route is the alerts task. If the alerts route is not merged yet, the button still calls that path.

Acceptance: duplicate delivery does not send twice. `LINK` with a fresh code sets `profiles.phone` and replies with the confirmation. A question from a linked number with `PLUTO_LLM=mock` and `SMS_PROVIDER=simulator` stores an outbound row whose body ends with `/open/`. Unknown number does not create a profile. Wrong webhook secret is 401.

### assistant-alerts (after sync)
`POST /api/alerts/demo`: session student must equal `studentId`, or a valid `x-internal-secret` (checked first). Then the admin client. `getCrunchWeeks` for that student, heaviest week (`rank` 1). Insert an `alerts` row (`kind: "crunch_week"`, `week_start`, `message`, `calendar_feed_token` from `newFeedToken()`, `student_id` explicit) and one `study_blocks` row per assignment in that week (title, `course_id`, 90 minutes ending at `dueAt`; skip a row that would break `ends_at > starts_at`). `sendSms` the scripted sentence plus `calendarFeedUrl`. No phone: the alert row remains, `sent: false`. Response is `AlertResponse`. Empty crunch list still sends a short "nothing due" text and still returns a calendar URL.

`GET /cal/[token].ics`: App Router segment `apps/web/app/cal/[token]/route.ts`. The segment arrives as `<token>.ics`; strip the suffix, anything else is 404. Public path (already). Look up with `getCalendarFeed` on the admin client, 404 when null, else `buildIcs` with `Content-Type: text/calendar; charset=utf-8`. Events are that alert's blocks only.

Acceptance: demo as the demo student (or a throwaway with assignments) returns `sent` and a `/cal/<token>.ics` URL. Fetching it returns a calendar that `ical.js` parses into those blocks. A different student's token does not appear. Wrong or missing auth is 401/403 and writes no alert. Another student's feed token is 404.

## After each coder PR
1. If the PR is labeled `security-review`: from that coder's worktree, write `.review/diff.patch` (`git diff agent/assistant...HEAD`), run one fresh `cursor-agent -p --force --trust --model grok-4.7-high` with CLAUDE.md, REVIEW.md, the contract, the task file, and the diff. Post `.review/review-1.md` with `gh pr comment`. No coder transcript and no orchestrator opinion in the prompt.
2. CHANGES REQUIRED: one fix round, one re-review. Still blocking on security or the contract: `orchestrations/escalations/assistant-<n>.md`, push, stop that task.
3. Ready for grokbot only when CI `check` is green and, if labeled, the verdict is `VERDICT: APPROVE`. Say both in the PR body. Never ask grokbot to merge a red PR.
4. After grokbot merges: `git pull` in `C:/Pluto-assistant`, rerun typecheck, lint, and test. Close that coder's herdr tab. Remove the worktree only when the branch is merged and the tree is clean.

## Milestone
When the done-when checks in `orchestrations/files/40-assistant.md` hold (live Gemini recorded, real Sendblue and Google Calendar import marked pending if Allen has not confirmed): merge `origin/agent/pluto` per 2e if needed, write `orchestrations/reports/assistant-F.md`, PR `agent/assistant` into `agent/pluto`. Then idle. Grokbot merges.

## Done-when map
| Check | Task |
| --- | --- |
| Mock web chat returns a cited file and page | routes |
| Mock SMS round trip returns a short answer plus a magic link that opens the right page | sms, after sync (web owns `/open`) |
| Live Gemini, both flows | orchestrator, after routes and sms; keys are in `C:/Pluto/.env.secrets` |
| Real Sendblue text from Allen's phone | pending Allen |
| Crunch demo SMS with an ICS link; `ical.js` parse | alerts |
| ICS imports into Google Calendar | pending Allen |
| `LINK <code>` binds `profiles.phone` | phone + sms |
