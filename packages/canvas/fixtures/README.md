# Canvas fixtures

Fixtures mirror Canvas REST endpoints under `/api/v1`.

- `courses.json` maps `/api/v1/courses`.
- `courses/<courseId>/assignment_groups.json` maps `/api/v1/courses/:courseId/assignment_groups`.
- `courses/<courseId>/assignments.page1.json` and `.page2.json` map `/api/v1/courses/:courseId/assignments` with synthetic `Link: rel="next"` pagination.
- `courses/<courseId>/files.json` maps `/api/v1/courses/:courseId/files`.
- `courses/<courseId>/modules-items.json` maps `/api/v1/courses/:courseId/modules?include[]=items`.
- Assignment `due_at` values can use `{{due:weeks=<wk>,days=<dow>}}`, which resolves at serve time using the same rule as `supabase/seed.sql`: Monday of the current week in `America/New_York`, plus `weeks`, plus `days` (1=Tue, 2=Wed, 3=Thu, 4=Fri), at 23:59 local, emitted as UTC ISO.

All data is synthetic and uses seeded Canvas IDs from `supabase/seed.sql`.
