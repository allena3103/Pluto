# Foundation report: milestone F1

Branch `agent/foundation` into `agent/pluto`. Build step 1 (schema and seed) plus the scaffold every other slice builds on.

## 1. What is done

| F1 item | Status | Where |
| --- | --- | --- |
| 1. Monorepo | Done | npm workspaces `apps/web`, `packages/core`; root scripts `typecheck`, `lint`, `test`, `smoke`, `env:local`, `seed`, `dev`; TS strict, ESLint, Vitest; `.gitignore` |
| 2. CI | Done | `.github/workflows/ci.yml`: install, typecheck, lint, then starts Supabase in the job (migrations + seed), `npm run seed`, `npm test` (database tests run, never skipped), `npm run smoke` |
| 3. Supabase | Done | `supabase/config.toml`, project `pluto`. OAuth 2.1 server and dynamic client registration are supported by the local CLI (3.1.0) and enabled, consent path `/oauth/consent`. `http://127.0.0.1:54321/auth/v1/.well-known/oauth-authorization-server` returns 200 |
| 4. Schema + RLS | Done (PR #2) | 12 tables, RLS on all, FTS (`file_pages.search` + GIN, `search_notes` function), private `notes` bucket with per-student path policies |
| 5. RLS test | Done (PR #2) | `packages/core/test/db/**`: other student and a fresh user read zero demo rows from every table, cannot write, cannot read or list storage; anonymous reads nothing; a new table without coverage fails the test |
| 6. Seed | Done (PR #2) | `supabase/seed.sql` + `npm run seed`, idempotent, fixed ids in `scripts/lib/seed-ids.ts`; dates relative to `now()` |
| 7. contract.ts | Done (PR #1) | `packages/core/src/contract.ts` (7 tools, 10 endpoints), `deep-links.ts`, `context.ts` |
| 8. Web shell | Done (PR #3) | Next 16 App Router, Tailwind 4, shadcn initialised, `lib/supabase/{server,client,admin,fetch}.ts`, `proxy.ts`, `(app)` layout guard |
| 9. env:local + .env.example | Done | `scripts/env-local.mjs`, `scripts/dev.mjs`, `.env.example` |

Done-when checks
- `npm run typecheck && npm run lint && npm test`: green (section 3).
- RLS test proves isolation: green locally and in CI.
- `npm run env:local && npm run dev`: signed-out `/` returns `307` to `/login?next=%2F`.

## 2. Contract items touched
- Data model: every table in the plan's outline, plus `sms_messages` and `study_blocks` (ICS feed source).
- All 7 MCP tool shapes and all 10 endpoint shapes, as zod schemas. No tool or endpoint name differs from `docs/plan.md`.
- Deep-link format `/notes/<fileId>?page=<n>`, 1-based.

Choices made where the plan was open (for the decision log)
1. Every student-owned table has `student_id uuid not null references profiles(id)`; children use composite foreign keys `(student_id, parent_id)`, so a row cannot point at another student's parent.
2. `magic_links` stores a SHA-256 hash of the token and has no client grants or policies (service role only).
3. `search_notes(p_student_id, p_query, p_course_id, p_limit)` is `security invoker` and filters by `p_student_id`, so it is safe for user sessions and for service-role callers.
4. ICS source is `study_blocks` linked to an `alerts` row; `alerts.calendar_feed_token` is the feed token.
5. Storage path is `notes/<student_id>/<file_id>.pdf`; bucket limited to PDFs up to 50 MB.
6. Client write access: students can insert, update and delete their own `courses`, `grade_groups`, `assignments`, `files`, `chat_sessions`, `chat_messages` and update their own `profiles` row. `file_pages`, `alerts`, `study_blocks`, `sms_messages` are read-only for students. `anon` has no grants.
7. `INTERNAL_API_SECRET` travels in the `x-internal-secret` header (`INTERNAL_SECRET_HEADER`).
8. `/api/chat` streams newline-delimited JSON (`application/x-ndjson`): `text`, `citation`, `done`, `error` events.
9. `/api/alerts/demo` accepts the signed-in student or the internal secret (director approved).
10. `get_recent_notes` text cap is 60,000 characters (`RECENT_NOTES_TEXT_CAP_CHARS`); each file reports `pagesIncluded` and `pageCount`. `get_note_pages` also has a `truncated` flag.
11. Ids validate with `z.guid()` so the fixed seed ids pass.
12. `get_deadlines` items need a due date; `points` and `weightGroup` are nullable. `/api/alerts/deadline-change` requires `oldDueAt`.
13. Next 16 renamed `middleware.ts` to `proxy.ts`; the session refresh lives in `apps/web/proxy.ts`. Public prefixes: `/login`, `/open`, `/oauth`, `/.well-known`, `/api`, `/cal`, `/auth`, `/_next`.
14. Agent env is `GEMINI_API_KEY`, `GEMINI_MODEL`, `PLUTO_LLM=mock|gemini`. `GEMINI_MODEL` is empty in `.env.example`; the assistant slice sets the default.
15. Seed passwords in `supabase/seed.sql` are local-dev defaults (same as `.env.example`). `npm run seed` resets them from `DEMO_STUDENT_PASSWORD` / `OTHER_STUDENT_PASSWORD`; set those before seeding the hosted project.

## 3. Checks run by the orchestrator on `agent/foundation` (after all three merges)
```
$ npm run typecheck   -> exit 0 (@pluto/web tsc --noEmit, @pluto/core tsc, scripts tsc)
$ npm run lint        -> exit 0
$ npm test
 Test Files  7 passed (7)
      Tests  116 passed (116)
$ npm run smoke
smoke: 0/0 files passed          (runner only; smoke files arrive in F2)
$ npm run build -w @pluto/web
Route (app)
┌ ƒ /
└ ○ /_not-found
ƒ Proxy (Middleware)
$ npm run env:local && npm run dev   (then stopped)
/            -> 307 http://localhost:3000/login?next=%2F
/api/x       -> 404
/notes/a.js  -> 307 http://localhost:3000/login?next=%2Fnotes%2Fa.js
```
CI on `agent/foundation`: `check` green, with the database tests running against Supabase started in the job (about 2 minutes).

## 4. Reviews per coder PR
| PR | Label | Fresh review | Outcome |
| --- | --- | --- | --- |
| #1 contract | none | Review 1 (Cursor): 2 blocking. Smoke runner bug was the orchestrator's and was fixed on `agent/foundation`; `DeepLink` was too loose and the coder tightened it to the notes shape with tests | Merged by grokbot, CI green |
| #2 db | `security-review` | Merged by grokbot before the label rule landed. Orchestrator read all four migrations in full. Post-merge fresh review: see PR #2 comments and section 5 | Merged |
| #3 shell | `security-review` | Review 1: missing Supabase timeouts, fixed (10 s timeout on every client, typed clients, narrower public paths). Review 2: one item, generated `next-env.d.ts` imports dev type files; orchestrator ruled it non-blocking because typecheck passes on a clean checkout and in CI | Merged by grokbot |

## 5. Open issues, risks, decisions needed
- The Claude usage limit stalled all agents for about two hours, so F1 landed after the 01:00 target. F2 coders and all reviewers now run on Cursor.
- The shell coder was handed from Claude to Cursor mid-task (same worktree, `HANDOFF.md`).
- PR #2 and PR #3 were merged before their fresh reviews said APPROVE. Nothing unsafe was found afterwards, but the gate was not followed in order.
- Hosted Supabase: OAuth server settings in `config.toml` apply to the local stack only. The hosted project needs the same settings turned on in the dashboard (mcp slice).
- `apps/web` still has a placeholder home page at `/`; the web slice replaces it and adds `/login` (currently 404).
- Machine memory is tight (1.4 to 2 GB free with one coder and one reviewer running).

## 6. How to UI-test (for grokbot)
1. `npm ci && npx supabase start && npm run env:local && npm run seed && npm run dev`.
2. Signed out, open `http://localhost:3000/`: expect a redirect to `/login?next=%2F` (the login page itself is a 404 until the web slice lands).
3. `http://localhost:3000/api/does-not-exist`: expect a plain 404, no redirect.
4. Signed in (session cookie for `demo@pluto.test`, password in `.env.example`): `/` returns 200 and shows the email, with no horizontal scroll at 390px.
