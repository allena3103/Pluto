# Orchestrator: assistant

Branch `agent/assistant`, worktree `C:/Pluto-assistant`, port 3400, migrations `20261114040000`-`20261114045959`. Starts after F2 merges. Follow `orchestrations/files/PROTOCOL.md`. Build steps 5 (API), 8, 9.

## Scope
1. **Agent loop** `packages/agent`: one Anthropic tool-use loop used by web chat and SMS. Tools are the same 7 core functions (same names and schemas as the MCP), plus internal `create_magic_link` for SMS replies. Output: reply text + citations `{ fileId, page, deepLink }`. Max tool rounds, timeouts, graceful error text. `PLUTO_LLM=mock` runs a deterministic scripted model so tests and demos work with no key.
2. **`POST /api/chat`** (signed-in): session id + message -> streamed reply with citations; persists `chat_sessions` / `chat_messages` (channel `web`).
3. **`POST /api/agent/reply`** (`INTERNAL_API_SECRET`): student id, text, channel -> reply text + optional deep link. SMS replies are short and end with a magic link to the cited page.
4. **`POST /api/magic-link`** (internal): wraps core `createMagicLink`, returns the one-time URL `/open/<token>` (web owns `/open`).
5. **`POST /api/sms/inbound`**: Sendblue webhook (verify `SENDBLUE_WEBHOOK_SECRET`; payload `from_number`, `content`), finds the student by phone, calls the agent, sends the answer via core `sendSms`. Unknown numbers get a polite fixed reply. Idempotent on duplicate webhook delivery.
6. **SMS simulator** `/sms-sim` (+ `components/sms-sim`): phone-style thread for the signed-in student; sending posts through the same inbound path with `SMS_PROVIDER=simulator`; shows replies from `sms_messages`.
7. **`POST /api/alerts/demo`**: the demo button (on `/sms-sim`) sends the scripted "heaviest crunch week" text from core `getCrunchWeeks` with the ICS link.
8. **`GET /cal/[token].ics`**: per-student feed token -> study blocks and deadlines as ICS; valid in Apple and Google Calendar.

## Done when
- With `PLUTO_LLM=mock`: web chat question returns a cited file and page; SMS simulator round trip returns a short answer + magic link that opens the right page.
- With a real `ANTHROPIC_API_KEY`: the same two flows work live (pending until Allen provides the key; report as pending).
- Sendblue: a real text from Allen's phone gets an answer (pending keys).
- Crunch-week demo button produces the SMS with an ICS link; the ICS validates (e.g. `ical.js` parse in a test) and imports into Google Calendar (Allen confirms).
