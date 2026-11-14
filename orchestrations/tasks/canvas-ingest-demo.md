# Coder task: canvas-ingest-demo

Branch `agent/canvas-ingest-demo`, worktree `C:/Pluto-canvas-ingest-demo`, base and PR target `agent/canvas`. Build steps 10 (PDF side of the sync) and 9 (the stage demo trigger). Port 3205. Migrations: none — do not add any.

You are a Cursor coder. Read `CLAUDE.md` (including "Allen's global rules"), `orchestrations/files/BRIEF.md` and `orchestrations/plans/canvas.md` first. Follow them.

**This PR is security-sensitive** (service-role Storage writes and an internal-secret route). The orchestrator labels it `security-review` and runs a fresh reviewer before grokbot merges.

## Goal
Two things. First, a synced Canvas PDF actually becomes searchable: download it, put it in Storage, ingest it into `file_pages`. Second, a one-button demo that moves a seeded due date through a fixtures sync, so the stage shows exactly one deadline-change text.

## What already exists (read it, do not change it)
- `@pluto/canvas/client`: `listCourseFiles` already returns PDF entries with `canvasFileId`, `title`, `url`, `updatedAt`, `createdAt`, `sizeBytes`.
- `@pluto/canvas/sync`: `syncCanvas` already upserts the `files` rows with `ingest_status: 'pending'` and `storage_path = <studentId>/<fileId>.pdf`. It does not move any bytes. Read its result type before you start.
- `@pluto/core/ingest`: `ingestFile(admin, fileId) -> { fileId, status, pageCount?, error? }`. It downloads from the `notes` bucket at `storage_path`, extracts text per page and fills `file_pages` 1-based. **Verify the real signature on your branch before coding; if it differs from this, stop and tell the canvas orchestrator.**
- `packages/canvas/src/deadline-alert.ts` and `/api/alerts/deadline-change`: already send the text and guard against duplicates within the hour.
- Storage: private bucket `notes`, object path `<student_id>/<file_id>.pdf`, 50 MB limit, `application/pdf` only (`supabase/migrations/20261113000400_storage_notes.sql`).

## You own (edit nothing else)
- `packages/canvas/src/files-sync.ts`, `packages/canvas/src/demo-trigger.ts`
- `packages/canvas/test/files/**`
- `packages/canvas/fixtures/demo/**` (new fixture set for the demo only)
- `apps/web/app/api/canvas/demo-date-change/route.ts`

Not yours, do not touch: every other file in `packages/canvas` (`client.ts`, `http.ts`, `fixtures.ts`, the existing `fixtures/**` outside `fixtures/demo/**`, `token-crypto.ts`, `sync.ts`, `map.ts`, `deadline-alert.ts`, `package.json`, `src/index.ts`), `packages/core/**`, `apps/web/lib/**`, `apps/web/components/**`, other `apps/web/app` routes, `supabase/**`, `scripts/**`, root configs, `package-lock.json`, `docs/plan.md`, `.env.example`. Need something outside your files: stop and reply to the canvas orchestrator.

## `files-sync.ts`
```ts
syncCanvasFiles(deps: { admin: PlutoDb; studentId: string; client: CanvasClient; now?: Date; ingest?: typeof ingestFile },
                options?: { maxFiles?: number })
  -> Promise<{ downloaded: number; ingested: number; skipped: number; failed: number; errors: string[] }>
```
- Select the student's `files` rows with `source = 'canvas'` and an explicit `.eq("student_id", studentId)` filter. Work on rows that are not already `ready`, plus rows whose Canvas `updated_at` is newer than what you last stored.
- **Skip rule:** a row that is `ready` and whose stored Canvas `updated_at` is unchanged is skipped with no download and no ingest. A second sync must download nothing. Record how you track the stored `updated_at` (an existing column you may write, or derive it from the Canvas listing) in the PR body; do not add a column without asking.
- Download: authenticated GET (Canvas file `url` carries its own token, but send the Authorization header when the host matches the configured Canvas base URL and omit it otherwise, so the token never goes to a third-party host). `AbortSignal.timeout` of 30 s, reject anything over 50 MB (check `Content-Length` first, and stop reading if the stream exceeds it anyway), and reject a `Content-Type` that is not a PDF.
- Upload to the `notes` bucket at the row's `storage_path` with the service-role client, `contentType: "application/pdf"`, `upsert: true`.
- Then call `ingestFile(admin, fileId)` and record the result. `ingest` is injectable so tests can run without a real PDF extractor.
- One file failing sets that row's `ingest_status = 'failed'` with a short `ingest_error` and continues with the rest. Nothing is left stuck in `processing`.
- Never write a row or an object for a student other than `studentId`. Nothing logs the Canvas token or the signed URL.

## `demo-trigger.ts` and `POST /api/canvas/demo-date-change`
- The demo: a fixtures-mode sync whose fixture set (`packages/canvas/fixtures/demo/**`) is identical to the normal fixtures except that **one** History 105 assignment's due date has moved. Use the relative `{{due:weeks=N,days=N}}` templates so it keeps working next week; move the date by a few days, not by months, so the text reads naturally on stage.
- `runDemoDateChange(deps)` runs that sync for one student and returns the sync result plus the alert outcome, so the stage operator sees what happened.
- Route auth, before any database work: either a signed-in student (and the target is always the session user, never a body value) or a valid `x-internal-secret` compared with `crypto.timingSafeEqual`, with `studentId` from the validated body. `INTERNAL_API_SECRET` unset means the internal path is unavailable and the route returns 500, never open. Service-role client only on the internal path.
- Running it twice must still send exactly one text: rely on the duplicate guard in `deadline-alert.ts` and prove it.
- `export const runtime = "nodejs"` and a `maxDuration` long enough for a sync plus an ingest.

## Acceptance checks (paste the real output tails in the PR body)
From `C:/Pluto-canvas-ingest-demo` after `npm install` and `npm run env:local -- --port 3205`:
1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build -w @pluto/web`, `npm run smoke` green, and `PLUTO_SKIP_DB_TESTS=1 npm test` green.
2. DB tests (`describe.skipIf(SKIP_DB_TESTS)`, throwaway users with unique emails, deleted in `afterAll`) proving:
   - a fixtures sync followed by `syncCanvasFiles` with an injected fake download ends with `ingest_status = 'ready'` and `file_pages` rows numbered from 1 with no gaps;
   - running both again downloads nothing and adds no `file_pages` rows (print the counts before and after);
   - a download that returns 404, one over the size cap, and one with a non-PDF content type each mark only that row `failed` with `ingest_error` set, leave the others `ready`, and leave nothing in `processing`;
   - the Authorization header is not sent when the file URL host differs from the configured Canvas host (assert on the injected fetch);
   - another student's files are untouched.
3. The demo trigger end to end against the seeded demo student, with real output: exactly one new `alerts` row (`kind = 'date_change'`), exactly one new outbound `sms_messages` row, and the moved assignment's `previous_due_at` and `due_changed_at` set. Then run it a second time and show that the counts did not change.
4. The SMS body text from the simulator row, so the director can judge the stage wording, and the `/sms-sim` URL where grokbot can see it.
5. A "How to UI-test (for grokbot)" section: the exact URL and payload to fire the demo, what to look for in `/sms-sim`, and what the notes page should show for an ingested file.

## Process
- Local Supabase is shared and running: never stop it, never `supabase db reset`.
- Commit small, `git push -u origin agent/canvas-ingest-demo` after every commit.
- Stop the dev server as soon as a check is done; memory is very tight and other agents are running.
- Open a PR into `agent/canvas` using `.github/pull_request_template.md`.
- CI (`check`) must be green before you reply DONE; check with `gh pr checks <pr>`. Grokbot merges, you never merge.
- Reply `DONE <PR URL>`, or `BLOCKED:` with what you need.
