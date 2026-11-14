# Orchestrator: web

Branch `agent/web`, worktree `C:/Pluto-web`, port 3100, migrations `20261114010000`-`20261114015959`. Starts after F1 merges. Follow `orchestrations/files/PROTOCOL.md`. Build steps 5 (UI), 6, 7, 11. Mobile first (390px), Tailwind + shadcn/ui.

## Scope
1. **Login** `/login`: Supabase email+password (demo accounts) and magic email optional. Must honor a `next` query param (the MCP consent page `/oauth/consent?authorization_id=...` redirects here and must come back).
2. **App shell** in `(app)`: nav for Chat, Notes, Grades, Deadlines, plus links to `/settings/canvas` (canvas owns the page) and `/sms-sim` (assistant owns the page). Installable PWA: manifest, icons, service worker for the shell.
3. **Chat screen** `/chat`: Claude-style UI. Calls `POST /api/chat` (assistant builds it after F2) and renders a streamed reply with citation chips (file + page) that open the viewer. Build against the `contract.ts` shape; until `/api/chat` exists, use a local fixture behind a dev flag, removed before your final milestone PR.
4. **Notes and PDF viewer** `/notes` (files by course and week) and `/notes/[fileId]?page=n`: pdf.js viewer that opens at page n (1-based), signed Storage URL fetched server-side, page jump, works on phone.
5. **Magic link open** `/open/[token]`: calls core `consumeMagicLink`, establishes a session for that student on the phone (e.g. admin `generateLink` + `verifyOtp` token-hash flow), then redirects to `/notes/<fileId>?page=<n>`. Expired or used tokens show a clear error.
6. **Grades** `GET /api/grades` (same data as core `getGrades`) and `/grades`: per course, per group score and weight, running weighted grade, ungraded count.
7. **Deadlines** `/deadlines`: upcoming from core `getDeadlines`, showing moved dates (previous due date struck through).
8. **Polish:** loading and error states on every screen.

## Done when
- Signed-out user is redirected to `/login?next=...` and returns after login.
- `/notes/<seed fileId>?page=3` opens page 3 on a 390px viewport.
- A magic link created with core `createMagicLink` opens the right PDF page in a fresh browser, once; second use fails.
- `/grades` matches `getGrades` output for the demo student.
- Chat renders citations that open the viewer at the cited page (against the real `/api/chat` once assistant's milestone has merged into `agent/pluto`).
- Grokbot can follow your "How to UI-test" steps on the Vercel preview.

## Added 2026-11-14 (director)
9. **Sign-up** `/signup`: name, email, password via `supabase.auth.signUp` (name in `options.data.name`); generic errors, no account-existence leaks beyond what Supabase returns; validated `next` passes through; link from `/login` and back. Email confirmation is off.
10. **Phone linking** `/settings/phone`: calls `POST /api/sms/link-code` (assistant builds it) and shows the code with instructions "Text LINK <code> to <SENDBLUE_FROM_NUMBER>"; shows the linked phone from `profiles` once set. Never writes `profiles.phone` itself.
11. PR #23 is being finished by the director directly (fix round 2, see `orchestrations/tasks/web-shell.md` amendment). PR #24 waits for #23, then needs a notes-only diff and green CI.
