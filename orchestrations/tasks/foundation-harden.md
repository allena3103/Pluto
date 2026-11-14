# Coder task: foundation-harden (spawned by the director)

Branch `agent/foundation-harden`, worktree `C:/Pluto-foundation-harden`, base and PR target `agent/foundation`. Port 3009. Migration: `supabase/migrations/20261113000500_harden_student_writes.sql` (one new file; never edit existing migrations). Label the PR `security-review`.

## Why
Grokbot's review of milestone PR #9 (https://github.com/allena3103/Pluto/pull/9#pullrequestreview-5901899844) found two data-isolation issues and one minor proxy issue.

1. `files.storage_path` is writable by the owning student. Ingest runs with the service role and downloads from `storage_path`, so a student could point their own row at `<other_student_id>/<file>.pdf` and copy another student's PDF into their own `file_pages`.
2. `profiles` lets students update every column, including `canvas_base_url` (SSRF once Canvas sync fetches it), `canvas_token_encrypted`, and `phone` (claiming someone else's number for SMS).
3. `apps/web/proxy.ts` skips the sign-in check for any path ending in an image or font extension, e.g. `/notes/abc.png`.

## You own (edit nothing else)
- `supabase/migrations/20261113000500_harden_student_writes.sql` (new)
- `packages/core/test/db/**` (add tests; keep existing ones passing)
- `apps/web/proxy.ts` (only the static-asset bypass)
- `packages/core/src/database.types.ts` only if regenerating types changes it

## Change
1. `files`: add `check (storage_path is null or storage_path = student_id::text || '/' || id::text || '.pdf')`. Revoke student `insert`, `update`, `delete` on `files` (writes go through server routes with the service role: ingest, Canvas sync). Drop the now-unused student insert/update/delete policies on `files`. Keep student `select`.
2. `profiles`: revoke `update` on `profiles` from `authenticated`, then `grant update (name) on public.profiles to authenticated`. Phone, Canvas base URL and Canvas token are written only by server routes.
3. Make sure the seed (`supabase/seed.sql`, `scripts/seed.ts`) still satisfies the new constraint; if a seeded `storage_path` doesn't match `<student_id>/<file_id>.pdf`, report it to the director instead of editing seed files (foundation owns them).
4. `proxy.ts`: apply the image/font extension bypass only to real static paths (`/_next/`, files served from `public/`, e.g. `/icons/`, `/favicon.ico`, `/manifest.webmanifest`), not to arbitrary app routes. A signed-out request to `/notes/abc.png` must redirect to `/login?next=...`.
5. Apply locally: `npx supabase migration up` against the shared stack (never `db reset`).

## Acceptance (paste real output in the PR)
- New tests: signed in as `other@pluto.test` and as the demo student, `update files set storage_path = ...` and `insert into files` fail; updating own `profiles.name` succeeds; updating own `phone`, `canvas_base_url`, `canvas_token_encrypted` fails. A service-role insert with a mismatched `storage_path` violates the check constraint.
- Signed-out `GET /notes/abc.png` -> 307 to `/login?next=%2Fnotes%2Fabc.png`; `/_next/static/...` and `/favicon.ico` still served without auth.
- `npm run typecheck`, `npm run lint`, `npm test` green, database tests not skipped. On Windows, put Docker on PATH as `C:\Program Files\Docker\Docker\resources\bin` before `npm run env:local`.
- PR body uses `.github/pull_request_template.md`; label `security-review`. Then reply DONE with the PR URL.
