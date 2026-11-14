# Orchestrator: foundation

Branch `agent/foundation`, worktree `C:/Pluto-foundation`, port 3000, migrations `20261113000000`-`20261113235959`. Follow `orchestrations/files/PROTOCOL.md`.

Everything else waits on you. Deliver two milestone PRs into `agent/pluto`, F1 then F2. Do not wait for F1 to merge before starting F2 work; branch F2 coders off your branch as soon as F1 content is on it.

## F1 (target Sat 01:00 EST): web and canvas start after this merges
1. **Monorepo.** npm workspaces: `apps/web`, `packages/core`. Root scripts: `typecheck`, `lint`, `test`, `smoke`, `env:local`, `dev`. TypeScript strict, ESLint, Vitest. `.gitignore` covers `.env*` (not `.env.example`), `.review/`, `node_modules`, `.next`, `supabase/.temp`, `seed/real/`.
2. **CI.** GitHub Actions on push and PR: install, typecheck, lint, test. CI must run the database tests too, including the RLS isolation test: start Supabase in the job (`supabase/setup-cli` action, `supabase start`, `supabase db reset` to apply migrations and seed), then run tests with the local keys. Grokbot merges only on green CI, so this is the main safety net against cross-student leaks.
3. **Supabase.** `supabase/config.toml` (Supabase CLI as a root devDependency, run via `npx supabase`). Enable the OAuth 2.1 server and dynamic client registration in config if the local CLI supports it, with authorization path `/oauth/consent` (mcp needs this; if unsupported locally, note it in the report).
4. **Schema + RLS** for every table in `docs/plan.md` "Data model outline", plus `sms_messages` (simulator store: student, direction, body, created_at) and a `study_blocks` or equivalent source for the ICS feed if needed. FTS: `file_pages.search` generated `tsvector` + GIN index, and a `search_notes` SQL function that ranks pages and returns a snippet (`ts_headline`). Storage bucket `notes` (private) with per-student path policies. `profiles` keyed by `auth.users.id`; phone unique for SMS lookup; `canvas_token_encrypted` column.
5. **RLS test.** Done when a test signs in as `other@pluto.test` and gets zero rows from every table for the demo student, and cannot read the demo student's storage objects.
6. **Seed.** Demo student `demo@pluto.test`, second student `other@pluto.test`, courses (History 105 + two more), assignments across the next 8 weeks (one crunch week), grade groups with weights, some graded scores, one assignment with a seeded previous due date (the date-change demo). Seed must be re-runnable by the director.
7. **contract.ts.** zod schemas for the inputs and outputs of all 7 MCP tools and all 10 internal endpoints, matching `docs/plan.md` field by field. Add the deep-link format: `/notes/<fileId>?page=<n>` (1-based). If the doc is ambiguous, pick the simplest shape and list your choices in the report for the director to log.
8. **Web shell.** Next.js App Router in `apps/web`, Tailwind + shadcn/ui initialized, Supabase SSR helpers (`apps/web/lib/supabase/{server,client,admin}.ts`), `middleware.ts` session refresh, a minimal `/login` placeholder is NOT yours (web owns it); provide an `(app)` route group with an authed layout guard only.
9. **env:local script** as described in BRIEF, plus `.env.example` listing every variable used anywhere in the plan (Supabase, `GEMINI_API_KEY`, `GEMINI_MODEL`, `PLUTO_LLM` (`mock`|`gemini`), `SMS_PROVIDER`, `SENDBLUE_API_KEY_ID`, `SENDBLUE_API_SECRET`, `SENDBLUE_FROM_NUMBER`, `SENDBLUE_WEBHOOK_SECRET`, `CANVAS_MODE`, `CANVAS_BASE_URL`, `CANVAS_TOKEN_KEY`, `PLUTO_DEMO_MCP_TOKEN`, `INTERNAL_API_SECRET`, `APP_URL`, demo passwords).

## F2 (target Sat 05:00 EST): mcp and assistant start after this merges
1. **Synthetic PDFs.** A script generates 6-10 text-based lecture PDFs (History 105 weeks 1-6, plus a couple for other courses), multi-page, with distinctive searchable facts per page. Commit the generated PDFs under `seed/pdfs/` (they're synthetic, safe). Seed uploads them to Storage with `added` dates spread over the last 3 weeks.
2. **Ingest.** `packages/core` ingest function (per-page text extraction, 1-based pages) and `POST /api/ingest` (`{ fileId }`, service role, `INTERNAL_API_SECRET` header) filling `file_pages` and `files.ingest_status`. Seed runs ingest for all seed PDFs.
3. **Core tool functions** for all 7 tools (`listCourses`, `getRecentNotes` with text cap + `truncated`, `getNotePages`, `searchNotes`, `getDeadlines`, `getGrades` with running weighted grade, `getCrunchWeeks`), each `(ctx: { db, studentId }, input) -> output` validated by `contract.ts`, each filtering by `studentId`, each result carrying deep links.
4. **Shared helpers in core:** magic links (`createMagicLink`, `consumeMagicLink`: single use, 15 min expiry, bound to student/file/page), SMS provider interface (`sendSms` with `simulator` writing `sms_messages` and `sendblue` HTTP with timeout), ICS builder and feed-token lookup, deep-link builder.
5. **Smoke script** `npm run smoke`: against local Supabase as the demo student, calls every core tool function, checks a known search query returns the expected file and page, checks `other@pluto.test` sees nothing of the demo student. Later orchestrators extend it with their own files under `scripts/smoke/`.

## Done when
- F1: `npm run typecheck && npm run lint && npm test` green; RLS test proves isolation; `npm run env:local && npm run dev` shows the authed shell redirecting to `/login` when signed out.
- F2: `npm run smoke` green; a known query returns the right file and page; `getRecentNotes` sets `truncated` when over the cap.

## Notes
- Docker Desktop is running; see BRIEF for the PATH note.
- You start and own the shared local Supabase stack (`npx supabase start` from your worktree). Leave it running.
