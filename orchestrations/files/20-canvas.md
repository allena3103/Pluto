# Orchestrator: canvas

Branch `agent/canvas`, worktree `C:/Pluto-canvas`, port 3200, migrations `20261114020000`-`20261114025959`. Starts after F1 merges. Follow `orchestrations/files/PROTOCOL.md`. Build steps 9 (deadline-change) and 10.

## Scope
1. **Canvas client** `packages/canvas`: typed client for courses, assignments (due_at, points, assignment group), assignment groups (weights), submissions (scores), files/modules (lecture PDFs). Pagination via `Link` headers, 429/403 rate-limit backoff, timeouts, empty-response handling. `CANVAS_MODE=fixtures` replays recorded JSON in `packages/canvas/fixtures` (synthetic, no real student data).
2. **Token settings** `/settings/canvas`: student pastes a Canvas personal access token and base URL (default `https://umamherst.instructure.com`, confirm with Allen via the director if unsure). Token encrypted with AES-256-GCM (`CANVAS_TOKEN_KEY`) into `profiles.canvas_token_encrypted`; never returned to the client.
3. **Sync** `POST /api/canvas/sync` (signed-in student, or service role + `INTERNAL_API_SECRET` for cron): upserts courses, assignments, grade groups, scores, files; downloads new PDFs to Storage and calls ingest; idempotent.
4. **Deadline-change detection:** on each sync compare each assignment's due date and title with the saved copy; when the due date moves, set previous due date and changed time, then call `POST /api/alerts/deadline-change`.
5. **`POST /api/alerts/deadline-change`** (`INTERNAL_API_SECRET`): texts the student the new date with their ICS link via core `sendSms`.
6. **Demo trigger:** a fixtures-mode sync that moves one seeded assignment's due date, so the alert can be shown on stage.

## Done when
- Fixtures-mode sync twice is idempotent (row counts stable) and a moved due date in fixtures produces exactly one alert row and one `sms_messages` row.
- Live mode against Allen's token (when he provides it in `.env.secrets`) syncs his courses; until then, report it as pending, not done.
- Token never appears in any API response, log or client bundle.
