# Coder task: web-grades (/api/grades, /grades, /deadlines)

Branch `agent/web-grades`, worktree `C:/Pluto-web-grades`, PR into **`agent/web`**. Port **3103**. Orchestrator: web. Build step 7 plus the deadlines screen.

Everything you need already exists in `packages/core`: your job is a thin authenticated route plus two mobile-first screens. Do not reimplement the grade maths.

## Read first
- `CLAUDE.md`, `orchestrations/files/BRIEF.md`, `orchestrations/plans/web.md`.
- `apps/web/AGENTS.md`: **this is Next 16, not the Next you know.** Read the relevant guides in `node_modules/next/dist/docs/` (resolve from `apps/web`) first. `params`/`searchParams` are Promises: `await` them. Route handlers live in `app/api/.../route.ts`.
    10|- `packages/core/src/contract.ts`: `GradesRequest`, `GradesResponse`, `GetGradesOutput`, `CourseGrades`, `GradeGroup`, `GetDeadlinesInput`, `GetDeadlinesOutput`, `Deadline`, `DeadlineStatus`, and the `ENDPOINTS.grades` entry (`GET /api/grades`, `auth: "session"`, request in the query string). Read the weighted-grade formula comment above `CourseGrades`.
- `packages/core/src/tools/index.ts` (`getGrades`, `getDeadlines`, `ToolError`), `packages/core/src/context.ts` (`makeToolContext`). **Never edit `packages/core/**` or `docs/plan.md`.**
- Shell landed by `web-shell`: `apps/web/components/ui/**`, nav, theme tokens.

**You are running in parallel with `web-shell`, which owns `apps/web/components/ui/**`, the nav, the theme tokens, `apps/web/app/globals.css` and `apps/web/app/(app)/layout.tsx`.** So:
- **Never create or edit a file under `apps/web/components/ui/**`**, even if a shadcn primitive you want is missing. Write plain Tailwind markup inside your own `components/grades/**` and `components/deadlines/**` instead (slate palette, rounded-xl cards, `text-sm` body, as in the existing `(app)` placeholder).
- Do not run `npx shadcn@latest add`.
- If `web-shell` has merged into `agent/web` before you finish, merge `agent/web` into your branch and swap your cards and badges over to the primitives where it is a one-line change. Otherwise leave it; the orchestrator does the visual pass.

## Setup
```
npm install
npm run env:local -- --port 3103
npm run dev -w @pluto/web
```
Shared local Supabase is already running and seeded. **Never `supabase db reset`, never `supabase start/stop`.** No migrations in this task. Login: `demo@pluto.test`, password `DEMO_STUDENT_PASSWORD` from `.env.example`. If the seed looks missing, run `npm run seed` once (idempotent). Stop the dev server when you are not using it (~2 GB free memory).
    20|
## Files you own (touch nothing else)
- `apps/web/app/api/grades/**`
- `apps/web/app/(app)/grades/**`
- `apps/web/app/(app)/deadlines/**`
- `apps/web/components/grades/**`
- `apps/web/components/deadlines/**`

Do not edit `apps/web/package.json` or the lockfile; everything you need is installed. Need a dependency: ask the orchestrator.

## What to build
    30|
### 1. `GET /api/grades`
```ts
const supabase = await createClient();                  // @/lib/supabase/server
const { data: { user } } = await supabase.auth.getUser();
if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
const parsed = GradesRequest.safeParse({ course: searchParams.get("course") ?? undefined });
const ctx = makeToolContext({ db: supabase, studentId: user.id, appUrl: getServerEnv().appUrl });
const out = await getGrades(ctx, parsed.data);
return Response.json(GradesResponse.parse(out));        // validate before sending
```
- Session client only. `lib/supabase/admin.ts` (service role) is forbidden in this task. Keep the explicit `studentId` from the session; never read a student id from the query or the body.
- Error mapping from `ToolError.code`: `invalid_input` -> 400, `course_not_found` -> 404, `course_ambiguous` -> 409, `db_error` -> 500. Body shape `{ error: string }` with a short safe message. Never leak a Postgres error string or another student's data.
    40|- No caching: this is per-student data (`export const dynamic = "force-dynamic"` or an explicit `Cache-Control: no-store`).

### 2. `/grades`
Server component calling `getGrades` directly (same context as above; do not fetch your own route over HTTP). Per course: course name, the running weighted grade (big, with "no graded work yet" when it is null), the ungraded count, and a row per group with name, weight percent and score percent (or a dash when null) plus graded/ungraded counts. Round for display only; the numbers must match `/api/grades`.

### 3. `/deadlines`
Server component calling `getDeadlines` with the default 30 days. Soonest due first, grouped by day or week, each item: title, course, due date and time, points, weight group, status badge (`upcoming`, `submitted`, `graded`, `overdue`). When `previousDueAt` is not null, show the **previous date struck through** next to the new one and a "date moved" marker. The seeded moved assignment is `a0000000-0000-4000-8000-000000000101` in History 105 (`scripts/lib/seed-ids.ts`). Empty state when nothing is due.

### 4. States
`loading.tsx` with skeletons and `error.tsx` with a retry for both screens. Mobile first: one column at 390px, no horizontal scroll, no table that needs sideways scrolling.

    50|## Acceptance checks (run them, paste the output in the PR)
```
npm run typecheck                 # exit 0
npm run lint                      # exit 0
npm test                          # 136+ passed, 0 failed
npm run build -w @pluto/web       # succeeds; /api/grades, /grades, /deadlines listed
```
Manual (dev server on 3103, signed in as the demo student in a browser at 390px; for curl, copy the session cookie from the browser devtools):
1. `GET /api/grades` signed out -> 401 JSON, no data.
2. `GET /api/grades` signed in -> JSON that `GradesResponse.parse` accepts (prove it: a tiny `node --input-type=module` or `tsx` snippet in `.review/` that fetches with the cookie and parses; `.review/` is gitignored).
3. `GET /api/grades?course=History%20105` -> only that course. `?course=Chemistry%20111` (the other student's course) -> 404, never data. `?course=` -> 400 or all courses, your choice, documented.
    60|4. `/grades` shows the same numbers as the endpoint for all three seeded courses (History 105, Biology 151, Statistics 240).
5. `/deadlines` -> soonest first; the History 105 moved assignment shows its old date struck through.
6. Both screens at 390px: no horizontal scroll; loading skeletons appear on a slow reload.

## Contract items touched
`ENDPOINTS.grades` (`GET /api/grades`, session auth, `GradesRequest` in the query, `GradesResponse` body) and the consumer side of `GetGradesOutput` / `GetDeadlinesOutput`. No shape changes: if the contract looks wrong, **stop** and tell the orchestrator (the director edits `docs/plan.md` first).

## Rules
- Commit small, push after every commit (`git push -u origin agent/web-grades` the first time).
- Never commit `.env.local`, a secret or a session cookie.
- Stay in the files listed above.
    70|
## PR body
Use `.github/PULL_REQUEST_TEMPLATE.md`: summary, build step and contract items, real output tails (typecheck, lint, test, build), merge-gate checkboxes, and "How to UI-test (for grokbot)" with the numbered steps above (login `demo@pluto.test`).

When the PR is open, reply `DONE` with the PR URL.
