# Canvas fixtures

Fixtures mirror Canvas REST endpoints under `/api/v1`.

- `courses.json` maps `/api/v1/courses`.
- `courses/<courseId>/assignment_groups.json` maps `/api/v1/courses/:courseId/assignment_groups`.
- `courses/<courseId>/assignments.page1.json` and `.page2.json` map `/api/v1/courses/:courseId/assignments` with synthetic `Link: rel="next"` pagination.
- `courses/<courseId>/files.json` maps `/api/v1/courses/:courseId/files`.
- `courses/<courseId>/modules-items.json` maps `/api/v1/courses/:courseId/modules?include[]=items`.

All data is synthetic and uses seeded Canvas IDs from `supabase/seed.sql`.
