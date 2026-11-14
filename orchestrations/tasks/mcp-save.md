# Coder task: mcp-save (Claude, opus): idea 1, Claude saves back to Pluto

Branch `agent/mcp-save`, worktree `C:/Pluto-mcp-save`, based on `agent/mcp-demo`, PR into `agent/mcp-demo`. Port 3601. Migration range `20261114060000`-`20261114060959`. Security-sensitive: label `security-review`. Shared brief: `orchestrations/files/BRIEF-mcp-demo.md`.

## Demo this enables (30 seconds on stage)
In Claude: "Build me a study guide from my History 105 notes from the past 2 weeks and save it to Pluto." Claude reads the notes, writes the guide with page links, calls `save_study_guide`. The guide appears on `/notes` under History 105. The phone gets `Pluto: your study guide "History 105 study guide" is saved. Open it: <link>`. Tapping the link signs the phone in and opens `/notes/saved/<id>`.

## Contract (read first; it wins over this file)
`docs/plan.md`: "MCP contract" (the `save_study_guide` row and "Write tool rules"), the `saved_notes` and `magic_links` rows in "Data model outline", the `/open/:token` row, and the last decision-log row.

## Files you own
- `supabase/migrations/20261114060000_*.sql` (new, one file is fine)
- `packages/core/src/contract.ts`: `SaveStudyGuideInput` / `SaveStudyGuideOutput` and a separate write-tool map (for example `WRITE_TOOLS`, `WriteToolName`). Do **not** add it to `TOOLS` / `TOOL_NAMES`: the web/SMS agent (`packages/agent/src/declarations.ts`) and the web page (`apps/web/lib/mcp-connect.ts`) iterate those, and the agent must never see the write tool.
- `packages/core/src/save-study-guide.ts` (new), `packages/core/src/tools/tool-error.ts` (add `rate_limited`), `packages/core/src/magic-links.ts` (saved-note target), `packages/core/src/database.types.ts` (only the columns you change; if you regenerate, drop anything from other branches' tables), `packages/core/src/index.ts` exports, new tests under `packages/core/test/**`.
- `packages/mcp/src/server.ts` (tool list/call handlers only), `packages/mcp/src/descriptions.ts`, `packages/mcp/src/handler.ts`, `packages/mcp/src/auth.ts` only if needed, `packages/mcp/test/**` (except `prompts*.test.ts`).
- `apps/web/app/api/mcp/**` (route config: SMS provider and env), `apps/web/app/open/[token]/**` and its tests.
- `.env.example` only if you truly need a new variable (avoid it).

Not yours: `packages/mcp/src/prompts.ts` and the prompt handlers in `server.ts` (worker `mcp-prompts` adds `prompts: {}` to capabilities and two handlers in the same file; keep your `server.ts` edits to the tool handlers so the merge is trivial), `apps/web/lib/mcp-connect.ts`, `apps/web/components/**`, `apps/web/app/(app)/**` (worker `every-ai`), `packages/agent/**`.

## Build
1. **Migration.** `saved_notes.source text not null default 'chat' check (source in ('chat','mcp'))`. `magic_links`: `file_id` drops `not null`; add `saved_note_id uuid`; composite FK `(student_id, saved_note_id)` -> `saved_notes (student_id, id)` on delete cascade; check `num_nonnulls(file_id, saved_note_id) = 1`; index on `saved_note_id`. No new grants or policies: `magic_links` stays service-role only, `saved_notes` policies unchanged. Header comment explains why. Apply with `npx supabase migration up` (shared stack; never reset).
2. **Core `saveStudyGuide`** (one function every surface could call):
   - Parse input with the contract schema.
   - Rate limit: count `saved_notes` with `student_id = ctx.studentId`, `source = 'mcp'`, `created_at` in the last hour. At 10 or more: `ToolError("rate_limited", ...)`, nothing saved or texted.
   - Cited pages: every link in the body whose origin is the app origin and whose path parses with `parseNotePath`. Load those files with `student_id = ctx.studentId` and keep only pages from 1 to `page_count` (when known) of files the student owns. Dedupe; cap 100. Never read or echo a dropped id.
   - Class: `course` input via `resolveCourse` (same errors as other tools); else the class every kept file shares; else null.
   - Insert with `ctx.db` (OAuth: the student's own client under RLS; demo methods: service role), explicit `student_id`, `source: 'mcp'`, `session_id: null`, `sources` in the existing `[{ fileId, page }]` shape.
   - Text step, after the row exists: build the service-role client from an injected factory (never before this point), read `profiles.phone` for `student_id`; none -> `no_phone`. Otherwise create a magic link to the saved note (single use, 15 minutes, same hashing as file links) and send with `sendSms` (Sendblue or simulator, timeouts already in `sendSms`). Any failure -> `failed`, logged without the token, phone or provider text. The save is never undone.
   - Output per contract; `url` is the absolute `/notes/saved/<id>` web link (not the magic link; the magic link only goes by text).
3. **MCP server.** `tools/list` returns the 7 read tools plus `save_study_guide` with `annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }`. `tools/call` runs it through the same error handling as the read tools (`ToolError` -> `code: message`, everything else generic; redaction in URL mode). Works on all three auth methods. The handler passes a lazy service-role factory and the SMS settings (`SMS_PROVIDER`, env, fetch) from the route config.
4. **Descriptions.** `SERVER_INSTRUCTIONS` no longer says read-only: it says the tools read the student's data and `save_study_guide` saves a finished guide to Notes and texts a link, used when the student asks to save (or a prompt says to). The tool description says: call it once per finished guide, pass the full markdown with the deep links kept, a short title, and the course when known.
5. **`/open/[token]`.** Saved-note links redirect to `/notes/saved/<id>` after the same sign-in as file links; file links unchanged; single use and expiry unchanged.

## Acceptance checks (prove each in the PR body)
- `tools/list` (demo bearer, port 3601) shows 8 tools; `save_study_guide` has the annotations above; the read tools still have `readOnlyHint: true`.
- `save_study_guide` as the demo student with a body linking two History 105 pages plus a link to an `other@pluto.test` file: a `saved_notes` row with `source = 'mcp'`, class History 105, only the two own pages in `sources`; the other student's page is not stored; `textStatus: "sent"`; an outbound `sms_messages` row for the demo student containing an `/open/` link.
- That `/open/<token>` link: first request redirects to `/notes/saved/<id>` signed in as the demo student; second request goes to the invalid location.
- OAuth path (a real Supabase access token for a test student) saves under RLS; `other@pluto.test` cannot select it.
- Student with no phone: saved, `textStatus: "no_phone"`, no SMS row.
- 11th save within the hour: `rate_limited`, no row, no text.
- URL-token route `/api/mcp/demo/<token>` with `PLUTO_DEMO_MCP_URL_ENABLED=1` saves too; with the flag off it is still 404.
- The web/SMS agent declarations still list exactly the 7 read tools (plus its own extras).
- DB tests cover the cases above; `npm run typecheck`, `npm run lint`, `npm test`, `npm run build -w @pluto/web` pass. Manual: build, start on 3601 in the background, curl `tools/list` and `tools/call save_study_guide`, curl the `/open/` link with `-i`, then stop the server.
