# Coder task: ui-batch (Claude, sonnet)

Branch `agent/ui-batch`, worktree `C:/Pluto-ui-batch`, based on `agent/pluto`, PR into **`agent/pluto`**. Port 3107. No migration, no `security-review` label.

Read `CLAUDE.md`, `orchestrations/files/BRIEF.md`, `apps/web/AGENTS.md` (Next 16; read the relevant docs in `node_modules/next/dist/docs/` before writing pages).

## 1. `/settings/phone`
Build `orchestrations/tasks/web-phone.md` exactly. Ignore its Cursor/model, base branch, and grokbot lines. `POST /api/sms/link-code` exists on this branch. Never write `profiles`.

## 2. `/api/grades` error text
`orchestrations/escalations/web-1.md`: `/api/grades` must not forward Postgres error text. Map errors to fixed strings; keep the status codes.

## 3. Polish (UI only)
- `/login` links to `/signup`, and `/signup` links back.
- The app nav links to `/settings/phone`. Leave other nav items alone; another coder may add an SMS link in the same component, so keep your change to one line where possible.
- Every `(app)` page has a loading state and a friendly error state (no raw error text). 390px wide, no horizontal scroll on `/`, `/notes`, `/chat`, `/grades`, `/deadlines`, `/settings/phone`.

## You own
`apps/web/app/(app)/settings/phone/**`, `apps/web/app/api/grades/**`, `apps/web/app/login/**`, `apps/web/app/signup/**`, `apps/web/app/(app)/**/loading.tsx`, `apps/web/app/(app)/**/error.tsx`, the nav component, `apps/web/components/**` for styling fixes only. Do not edit `apps/web/app/api/**` other than grades, `apps/web/app/(app)/sms-sim/**`, `apps/web/components/sms-sim/**`, `packages/**`, `proxy.ts`, migrations, or the lockfile.

## Delivery
`npm run typecheck`, `npm run lint`, `npm test -w @pluto/web`, `npm run build -w @pluto/web` once at the end. For the 390px pass, use a background server on 3107 that you stop afterwards. Commit small, push after every commit. `gh pr create --base agent/pluto --head agent/ui-batch --title "Web: phone settings, grades error text, polish"`, with a "How to UI-test" section. Reply `DONE <PR URL>` and go idle.
