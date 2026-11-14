# Coder task: web-notes (notes list and PDF viewer)

Branch `agent/web-notes`, worktree `C:/Pluto-web-notes`, PR into **`agent/web`**. Port **3102**. Orchestrator: web. Build step 6 (viewer half).

The page-level answer is the product: every MCP tool result carries a deep link `/notes/<fileId>?page=<n>`, and your viewer is what those links open. Page numbers are **1-based everywhere**.

## Read first
- `CLAUDE.md`, `orchestrations/files/BRIEF.md`, `orchestrations/plans/web.md`.
- `apps/web/AGENTS.md`: **this is Next 16, not the Next you know.** Read the relevant guides in `node_modules/next/dist/docs/` (resolve from `apps/web`) first. `params` and `searchParams` are Promises: `await` them. Session refresh already happens in `apps/web/proxy.ts`; the `(app)` layout already guards for a signed-in user. Do not touch either.
    10|- `packages/core/src/contract.ts` (`NotePage`, `IngestStatus`) and `packages/core/src/deep-links.ts` (`notePath`, `parseNotePath`). **Never edit `packages/core/**` or `docs/plan.md`.**
- Shell landed by `web-shell`: `apps/web/components/ui/**` primitives, nav, theme tokens. Reuse them; do not restyle them.

## Setup
```
npm install
npm run env:local -- --port 3102
npm run dev -w @pluto/web
```
Shared local Supabase is already running. **Never `supabase db reset`, never `supabase start/stop`.** No migrations in this task; if you think you need one, stop and tell the orchestrator. Login: `demo@pluto.test`, password `DEMO_STUDENT_PASSWORD` from `.env.example`. Stop the dev server when you are not using it (~2 GB free memory on this machine).

    20|## Files you own (touch nothing else)
- `apps/web/app/(app)/notes/**`
- `apps/web/components/notes/**`
- `apps/web/public/pdf.worker.*` **only if** you cannot make the worker resolve through the bundler (see below).

`pdfjs-dist` is already in `apps/web/package.json` (web-shell added it for you). **Do not edit `apps/web/package.json` or the lockfile.** Need another dependency: ask the orchestrator first.

## Data you read
Session client only: `const supabase = await createClient()` from `@/lib/supabase/server`, then `supabase.auth.getUser()`. **Every query also filters `.eq("student_id", user.id)` explicitly**, even though RLS already does. `lib/supabase/admin.ts` (service role) is forbidden in this task.

`public.files`: `id, student_id, course_id, title, week_label, added_at, source, storage_path, ingest_status ('pending'|'processing'|'ready'|'failed'), ingest_error, page_count`.
    30|`public.courses`: `id, student_id, name, term`. `public.file_pages`: `student_id, file_id, page_number, text` (unique on `file_id, page_number`).
Storage: private bucket `notes`, object path `<student_id>/<file_id>.pdf`, and `files.storage_path` holds that object path. Students may only read their own prefix (policy `notes_select_own`).

## What to build

### 1. `/notes`
Server component. The demo student's files grouped by **course**, then by **week label** (files with no week label last), newest `added_at` first inside a group. Each row: title, week label, added date, ingest status when it is not `ready`, page count when known; the whole row links to `/notes/<id>?page=1`.
Empty state (there are no seeded `files` rows until the foundation's F2 ingest lands, so this is the state you will see first): a short "No lecture notes yet" card, not a crash.
Mobile first: one column at 390px, no horizontal scroll.

### 2. `/notes/[fileId]`
    40|- `await params` for `fileId`, `await searchParams` for `page`.
- Load the file with `.eq("id", fileId).eq("student_id", user.id).maybeSingle()`. No row -> `notFound()`. Another student's `fileId` must give the not-found page and **never** a PDF or a signed URL.
- Sanitise `page`: integer >= 1 only; clamp to `page_count` when it is known; `0`, `abc`, `-2`, `1e3` and a page past the end all fall back to page 1. Never pass the raw string to pdf.js.
- Create the signed URL **server-side** from the session client: `supabase.storage.from("notes").createSignedUrl(file.storage_path, 60)`. Before using it, check `file.storage_path` starts with `${user.id}/`; if not, treat the file as not found. Pass only the signed URL to the client component. Short expiry, never cached, never logged.
- `ingest_status` not `ready` or `storage_path` null: show a clear "still processing" / "ingest failed" state with the title, not a broken viewer.
- Client viewer component (`components/notes/pdf-viewer.tsx`): `pdfjs-dist` rendering to a canvas, opening **at the requested page**, with prev/next, a "page n of m" jump input, and pinch/fit-to-width sizing that is readable at 390px. Changing the page updates the URL (`?page=n`, `router.replace`, no scroll jump) so the view is shareable and matches `parseNotePath`.
- Worker: resolve it through the bundler (`new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`) and set `GlobalWorkerOptions.workerSrc`. Only if that genuinely cannot work under Next 16 + Turbopack, copy the worker to `apps/web/public/` and load it from there; say which you did in the PR.
- Render errors (worker fails, URL expired): an error state with a retry, never a blank page. Add `loading.tsx` / `Skeleton` for the server fetch.
    50|- Optional, only if it is cheap: a "page text" toggle that shows `file_pages.text` for the current page, which also makes the page readable when rendering fails.

## Testing before F2 lands (no seeded files yet)
Create your own throwaway data in the shared local stack and **delete it when you are done**:
1. Put any scratch script under `.review/` (already gitignored). Generate a small multi-page PDF with selectable text locally (any generator, or write a minimal PDF by hand).
2. Sign in as the demo student with the anon key, insert one `files` row for `COURSE_IDS.history105` (`scripts/lib/seed-ids.ts`) with `ingest_status: 'ready'`, `page_count: 4`, `storage_path: '<demo_student_id>/<new_file_id>.pdf'`, upload the PDF to `notes` at that path, and insert a few `file_pages` rows.
3. Verify the acceptance checks, then delete the storage object and the `files` row (the `file_pages` rows cascade).
**Never commit a PDF, a fixture row or the scratch script.** Do not touch `supabase/seed.sql` or `scripts/**`. After the foundation's F2 seed lands, the orchestrator re-verifies you against the real seeded files.

## Acceptance checks (run them, paste the output in the PR)
    60|```
npm run typecheck                 # exit 0
npm run lint                      # exit 0
npm test                          # 136+ passed, 0 failed
npm run build -w @pluto/web       # succeeds; /notes and /notes/[fileId] listed
```
Manual (dev server on 3102, browser at 390px, signed in as the demo student):
1. `/notes` -> files grouped by course and week; with no files, the empty state (no error, no crash).
2. `/notes/<your test fileId>?page=3` -> **page 3** is the first page shown; the counter says 3 of 4.
3. Prev/next and the jump input move pages and update `?page=`; reloading keeps the page.
4. `?page=0`, `?page=abc`, `?page=99` -> page 1, no crash.
    70|5. The other student's file id (`other@pluto.test`, course `c0000000-0000-4000-8000-000000000009`) -> not-found page; no signed URL in the HTML (check with `curl.exe -s | Select-String "sign"`).
6. A file with `ingest_status: 'pending'` -> the processing state.
7. No horizontal scroll at 390px; the PDF fits the width.

## Contract items touched
No shape changes. You implement the consumer side of the deep-link format `/notes/<fileId>?page=<n>` (1-based) from `packages/core/src/deep-links.ts`, and read `files.ingest_status` (`IngestStatus`). If you think the contract must change, **stop** and tell the orchestrator.

## Rules
- Commit small, push after every commit (`git push -u origin agent/web-notes` the first time).
- Never commit `.env.local`, a secret, a signed URL or a PDF.
- Stay in the files listed above.
- Your PR does **not** need the `security-review` label, but it is read for exactly one thing first: that no path lets a student read another student's file.
    80|
## PR body
Use `.github/PULL_REQUEST_TEMPLATE.md`: summary, build step and contract items, real output tails (typecheck, lint, test, build), merge-gate checkboxes, and "How to UI-test (for grokbot)" with the numbered steps above and a note that real files appear only after the foundation's ingest seed lands.

When the PR is open, reply `DONE` with the PR URL.
