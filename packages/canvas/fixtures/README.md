# Canvas fixtures

Fixtures mirror Canvas REST endpoints under `/api/v1`.

- `courses.json` maps `/api/v1/courses`.
- `courses/<courseId>/assignment_groups.json` maps `/api/v1/courses/:courseId/assignment_groups`.
- `courses/<courseId>/assignments.page1.json` and `.page2.json` map `/api/v1/courses/:courseId/assignments` with synthetic `Link: rel="next"` pagination.
- `courses/<courseId>/files.json` maps `/api/v1/courses/:courseId/files`.
- `courses/<courseId>/files/<fileId>.json` maps `/api/v1/courses/:courseId/files/:fileId` (one file by numeric id). These are assignment attachments only, so they are not in `files.json` and never become notes: Statistics 240's Project Proposal (`seed-123`) links 24001 (PDF), 24002 (Word) and 24003 (spreadsheet, listed by name only) from its `description`; Biology 151's Lab Report 3 (`seed-112`) links 25001 (Word) and 25002 (spreadsheet). `seed-112`'s description, links and handout text match its seeded rows in `supabase/seed.sql`, so a fixtures sync of the demo student keeps them; change both together.
- Download URLs point at `https://fixtures.canvas.local/files/<name>.<pdf|docx>`, served from `demo/files/` (written by `demo/gen-files.mjs`).
- `courses/<courseId>/modules-items.json` maps `/api/v1/courses/:courseId/modules?include[]=items`.
- Assignment `due_at` values can use `{{due:weeks=<wk>,days=<dow>}}`, which resolves at serve time using the same rule as `supabase/seed.sql`: Monday of the current week in `America/New_York`, plus `weeks`, plus `days` (1=Tue, 2=Wed, 3=Thu, 4=Fri), at 23:59 local, emitted as UTC ISO.

All data is synthetic and uses seeded Canvas IDs from `supabase/seed.sql`.
