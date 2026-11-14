# Assistant handoff (2026-11-14 11:28 EST)

Wrap-up for the new Claude Code account. No new work was started. Nothing was merged by this orchestrator.

Branch `agent/assistant`, worktree `C:/Pluto-assistant`, port 3400, migrations `20261114040000`-`20261114045959`. Plan: `orchestrations/plans/assistant.md`. Task file: `orchestrations/files/40-assistant.md`. Timeline from `origin/agent/pluto` commit `20d5a90` (BRIEF): 17:00 `/api/chat` with Gemini (with web); 19:00 SMS round trip, phone linking, crunch-week alert, ICS feed. Milestone PRs into `agent/pluto` are synced first (PROTOCOL 2e) and the body asks grokbot for a merge commit, not squash.

## Running coders
None. Tabs `assistant-agent` and `assistant-phone` were already closed. No WIP was left uncommitted. No dev server was listening on 3400-3405.

## Open PRs
None. Both coder PRs are merged into `agent/assistant`. There is no milestone PR into `agent/pluto`.

| PR | State | CI | Review |
| --- | --- | --- | --- |
| [#28](https://github.com/allena3103/Pluto/pull/28) `agent/assistant-agent` Gemini loop | Merged 2026-11-14 16:15 UTC as `7ea9c74` | `check` green on `125956a` | Labeled `security-review`. Review 1: `CHANGES REQUIRED` (public `model` argument had been removed). Review 2: `VERDICT: APPROVE`. Comments on the PR. |
| [#29](https://github.com/allena3103/Pluto/pull/29) `agent/assistant-phone` phone link codes | Merged 2026-11-14 13:37 UTC as `876d870` | `check` green | Labeled `security-review`. Fresh review: `VERDICT: APPROVE`. |

What had blocked #28: grokbot would not merge a `security-review` PR without `VERDICT: APPROVE`. That verdict is posted. The merge is done.

## Branches and worktrees
| Path | Branch | Unmerged work |
| --- | --- | --- |
| `C:/Pluto-assistant` | `agent/assistant` (this handoff) | None. Matches origin after the push of this file. |
| `C:/Pluto-assistant-agent` | `agent/assistant-agent` at `125956a` | None. Squash-merged as #28. Clean. |
| `C:/Pluto-assistant-phone` | gone | Not a git worktree anymore. The directory only contains `node_modules`. #29 is merged. |

## Done
- `packages/agent` (`@pluto/agent`): `runAgent`, Interactions API loop (`store: false`, 4 rounds, 20s model / 10s tool timeouts), offline mock. Default model `gemini-4-hydrogen` (`GEMINI_MODEL` or that default). `@google/genai@3.3.0`. Tests pass `llm: "mock"` or a fake client.
- A thrown `ToolError` is returned to the model as `code: message`. Any other throw is a fixed sentence, with no stack and no raw error text.
- System prompt: tool text, including note pages, is untrusted data, not instructions.
- `model` is optional and server-side. A route must not copy it from the request body.
- `CreateMagicLink` is a host callback `{ fileId, page }`. This package does not check that the file belongs to the student. The host must.
- `POST /api/sms/link-code` (signed-in): 6-character code, SHA-256 hex only, 15-minute expiry, one unused code per student. `consumeLinkCode` binds `profiles.phone` with the service role. Migration `20261114040000_phone_link_codes.sql` (RLS on, no policies, service role only). `database.types.ts` was not edited. The cast that names the table is only in `apps/web/lib/phone-link.ts`.
- The fail-closed RLS inventory in `packages/core/test/db/helpers.ts` and `rls.test.ts` lists `phone_link_codes` the same way as `magic_links`. That was required so `npm test` passes on the shared database.

## Left (from `orchestrations/files/40-assistant.md`)
Not started:

1. `POST /api/chat` — session, NDJSON (`text`, `citation`, `done`, `error`), persist `chat_sessions` / `chat_messages` channel `web`. This is the 17:00 row. It can be built now against `packages/agent` and `TOOL_HANDLERS`. Web owns the chat screen.
2. `POST /api/agent/reply` — `x-internal-secret` before the admin client. Web channel deep link is the notes URL. SMS deep link is a magic link, which is not on this branch yet.
3. `POST /api/magic-link` — wraps core `createMagicLink`. Do not import `@pluto/core/magic-links` until the F2 sync.
4. `POST /api/sms/inbound` — webhook secret, idempotent, `LINK <code>` calls `consumeLinkCode`, otherwise `findStudentByPhone` + the agent + `sendSms`. Unknown numbers get a fixed reply and no `sms_messages` row.
5. `/sms-sim` and `components/sms-sim`.
6. `POST /api/alerts/demo` and `GET /cal/[token].ics` — the 19:00 row, after `sendSms`, `buildIcs`, `getCalendarFeed`, `newFeedToken`, and `calendarFeedUrl` arrive.

`createMagicLink`, `sendSms`, `recordInboundSms`, `findStudentByPhone`, `normalizePhone`, and the ICS helpers are still on foundation. They arrive by a sync PR after F2 merges to `agent/pluto`. Do not edit `packages/core` (director-owned after F2). `packages/core/src/sms.ts` `normalizePhone` should replace the copy in `phone-link.ts` after that sync.

## Known bugs and risks
- Local Supabase already has `phone_link_codes`. A worktree whose RLS inventory does not list that table fails `covers every public table`. CI for a branch that does not contain the migration is fine, because CI builds a fresh database.
- `C:/Pluto-assistant-phone` is an orphan `node_modules` directory, not a worktree. Do not treat it as a checkout.
- Live Gemini and a real Sendblue text were not run. Keys are in `C:/Pluto/.env.secrets`. Tests stay on `PLUTO_LLM=mock` and `SMS_PROVIDER=simulator`.
- Grokbot's note still stands for the chat route: do not pass `model` from the HTTP body. The host that implements `createMagicLink` must prove the file belongs to that student.

## Next steps
1. Pull `agent/assistant` (includes this file, #28, and #29).
2. For `/api/chat` only, a coder can branch from `agent/assistant` now. Owned files are in the plan under `assistant-routes`. Port 3403. Model `grok-4.7-high` because `/api/agent/reply` uses the internal secret; if that route is split off, chat alone is `grok-4.7-medium`.
3. When `origin/agent/pluto` has the F2 helpers, open `agent/assistant-sync` from `agent/assistant`, merge `origin/agent/pluto`, take theirs for files this slice does not own, keep `packages/agent/**`, the phone-link files, and `orchestrations/plans/assistant.md`. PR into `agent/assistant`. Then SMS, magic-link, alerts, and the ICS feed.
4. Milestone PR into `agent/pluto` when the 17:00 row works, and again for the 19:00 row. Ask grokbot for a merge commit, not squash. Do not merge it yourself.
