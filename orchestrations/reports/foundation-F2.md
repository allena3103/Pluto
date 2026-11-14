# Foundation report: milestone F2

Branch `agent/foundation` into `agent/pluto`. Build step 2 (PDF ingest and search) plus the shared core every surface calls.

## 1. What is done

| F2 item | Status | Where |
| --- | --- | --- |
| 1. Synthetic PDFs | Done (PR #25) | `scripts/gen-pdfs.ts`, `scripts/lib/lectures.ts`, `seed/pdfs/*.pdf` + `manifest.json`: 8 text PDFs (History 105 weeks 1-6, Biology 151, Statistics 240), 4 pages each, one distinctive fact and search query per page, `added` dates 2 to 20 days ago |
| 2. Ingest | Done (PR #25) | `packages/core/src/ingest.ts` (`extractPdfPages`, `ingestFile`, 1-based pages), `POST /api/ingest` (service role, `x-internal-secret`), seed uploads and ingests all PDFs |
| 3. Core tool functions | Done (PR #4) | `packages/core/src/tools/**`: `listCourses`, `getRecentNotes` (text cap + `truncated`), `getNotePages`, `searchNotes`, `getDeadlines`, `getGrades`, `getCrunchWeeks`, and `TOOL_HANDLERS` keyed by tool name |
| 4. Shared helpers | Done (PR #10) | `magic-links.ts`, `sms.ts`, `ics.ts`; deep links from F1 |
| 5. Smoke script | Done (PR #25) | `scripts/smoke/00-core.ts`, run by `npm run smoke` and in CI |
| Hardening after grokbot's review of PR #9 | Done (director's coder) | `20261113000500_harden_student_writes.sql`, `apps/web/lib/public-path.ts`, extra RLS tests |

Done-when checks
- `npm run smoke` green: section 3.
- A known query returns the right file and page: "Committee of Public Safety Robespierre Thermidor" returns `hist105-week5-french-revolution.pdf` page 3. The smoke script also checks that all 32 manifest queries hit their own page first.
- `getRecentNotes` sets `truncated` when over the cap: checked in the smoke script (1,000-character cap) and in the tools tests (real 60,000-character cap).

## 2. Contract items touched
- MCP tools: all 7, implemented against `contract.ts` with no shape change.
- Endpoint `/api/ingest`: implemented as specified.
- Tables `files`, `file_pages`, `magic_links`, `sms_messages`, `alerts`, `study_blocks`: used as designed.
- No change to `docs/plan.md` is needed.

How other slices use core
- Browser-safe: `@pluto/core` (contract, deep links, context types).
- Server-only, by subpath: `@pluto/core/tools/index` (`TOOL_HANDLERS[name](ctx, rawInput)`), `@pluto/core/ingest`, `@pluto/core/magic-links`, `@pluto/core/sms`, `@pluto/core/ics`, `@pluto/core/database.types`.
- Build a context with `makeToolContext({ db, studentId, appUrl })`. `db` may be a user-session client or a service-role client; every tool filters by `studentId` either way.
- Tool failures throw `ToolError` with `code` (`course_not_found`, `course_ambiguous`, `file_not_found`, `invalid_input`, `db_error`).

Rules that later slices must keep (from the hardening migration)
- Students cannot set `files.storage_path` or ingest fields, and can update only `profiles.name`. Writes to `files.storage_path`, `profiles.phone` and the Canvas columns need the service role in a server route.
- `files.storage_path` must equal `<student_id>/<file_id>.pdf` (check constraint, all roles). Ingest derives the key itself and never trusts the stored value.

## 3. Checks run by the orchestrator
```
$ npm run typecheck   -> exit 0
$ npm run lint        -> exit 0
$ npm test
 @pluto/web   Test Files  1 passed (1)    Tests  3 passed (3)
 @pluto/core  Test Files  16 passed (16)  Tests  177 passed (177)   (database tests ran)
$ npm run seed  (twice)
seed: 9 lecture PDFs uploaded and ingested (36 pages)
seed: rows for seeded students: auth.users=2 profiles=2 courses=4 grade_groups=10 assignments=35 files=9 file_pages=36
$ npm run smoke
PASS 00-core.ts
smoke: 1/1 files passed
$ npm run build -w @pluto/web   -> ƒ /   ƒ /api/ingest   ƒ Proxy (Middleware)
$ curl POST /api/ingest  (dev server on 3004, stopped afterwards)
no secret 401 | wrong secret 401 | bad body 400 | unknown file 404 | valid 200 {"status":"ready","pageCount":4}
```
CI `check` on the ingest PR: green, including seed, database tests and smoke.

## 4. Reviews per PR
| PR | Label | Fresh review | Outcome |
| --- | --- | --- | --- |
| #4 tools | none | Not required. Orchestrator read the code: every query filters by `student_id`, no writes. Two follow-up fixes pushed (generic database error text, no pages included after the cap) | Merged by grokbot |
| #10 helpers | `security-review` | Review 1 (Cursor): security checks passed; one blocking item, ICS continuation lines could be 76 octets. One fix round sent | Merged by grokbot |
| harden (f517ad6) | `security-review` | Director's coder; its PR #11 was closed as superseded and the commit reached `agent/foundation` and `agent/pluto` through PR #9 | Merged |
| #25 ingest | `security-review` | See the PR for the fresh review verdict | See PR |

## 5. Open issues, risks, decisions needed
- **Ingest was built by the orchestrator, not a coder.** Free memory stayed between 0.4 and 1.8 GB, under the 2 GB spawn rule, with no foundation coder running to wait for. The PR still went through CI and a fresh review.
- **Cursor's Codex 5.3 weekly allowance ran out** during the ingest review ("Buy credits or switch to a Grok model"). The review was rerun on `grok-4.7-medium`. Other orchestrators' Cursor coders and reviewers on `gpt-5.3-codex` will hit the same error. Buying credits is Allen's call.
- **Local database drift.** An earlier draft of the hardening migration had been applied to the shared local stack, so three RLS tests failed locally while CI was green. The orchestrator re-applied the committed grants, policies, constraint and trigger; local tests now pass. A director `supabase db reset` followed by `npm run seed` would remove any remaining drift.
- **Supabase side containers stopped to save memory** on the shared stack: analytics, vector, studio, edge runtime, realtime. Database, auth, REST, storage and the gateway are running. `npx supabase start` brings them back.
- The Claude usage limit stalled the orchestrator twice (about 2 hours and 3.5 hours), so F2 landed after the 05:00 target.
- `.limit()` values above 1,000 in the tools are capped by PostgREST's default of 1,000 rows. Page text is paged correctly; assignments and courses would need paging only for a student with more than 1,000 of them.
- PDFs with image-only pages ingest as empty page text (no OCR), as the plan's risk table expects.
- Hosted deploy: set `INTERNAL_API_SECRET`, the seed passwords and `APP_URL`, then run the seed against the hosted project to upload and ingest the PDFs.

## 6. How to UI-test (for grokbot)
No new screens in F2.
1. `npm ci && npx supabase start && npm run env:local && npm run seed && npm run smoke`: expect `PASS 00-core.ts`.
2. `npm run dev`, then `curl -i -X POST http://localhost:3000/api/ingest -H 'content-type: application/json' -d '{"fileId":"00000000-0000-4000-8000-000000000000"}'`: expect 401. With header `x-internal-secret: <INTERNAL_API_SECRET from apps/web/.env.local>`: expect 404 for that unknown id.
3. Signed out, `/` still redirects to `/login?next=%2F`.
