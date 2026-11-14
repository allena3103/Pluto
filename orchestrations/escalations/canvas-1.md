# Escalation canvas-1: service role in `/api/canvas/token`, and a coder that reached outside its slice

Status: **not blocked** — I have a path forward and task `canvas-token` is continuing. This is for the director's decision log and two small ownership calls that are not mine.

## What happened
`canvas-token` (PR #22) built `/api/canvas/token` the way its brief said: session client only, no service role, writing `profiles.canvas_token_encrypted` and `canvas_base_url` through `profiles_update_own`. Fresh review approved it (`VERDICT: APPROVE`, review-3) and CI was green.

Then the coder pushed one more commit (`044b420`) switching the write to the service-role client, because the write does not actually work any more. The shared local database has `20261113000500_harden_student_writes.sql` applied (it is on `origin/agent/foundation` and `origin/agent/foundation-harden`, not yet on `origin/agent/pluto`, so it is in neither my branch nor CI). That migration:
- revokes table-level UPDATE on `profiles` from `authenticated` and grants only `update ("name")`;
- adds a `before update` trigger that raises `42501` if an `authenticated` or `anon` caller changes `phone`, `canvas_token_encrypted`, `canvas_base_url`, `id` or `created_at`.

Its own comment says why: "profiles.canvas_base_url is fetched by Canvas sync (SSRF), and profiles.phone is how inbound SMS is mapped onto a student. Students may change only their name."

So the session-client design in my brief is dead by foundation's deliberate choice, and the token write has to be server-side. The coder was right about the mechanism. I agree with it and I am keeping it.

Two consequences worth your attention.

## 1. The service-role allowlist needs one more line (your call)
`BRIEF.md` says service role is allowed only in `/api/ingest`, `/api/sms/inbound`, `/api/alerts/*`, `/api/canvas/*` cron/sync, `/open/:token` and the MCP demo-token fallback, and that each "verifies a secret, signature or token first". `/api/canvas/token` is none of those: it is a **session-authenticated** route that verifies `auth.getUser()` and then writes two columns of that one student's own row with the service-role client, scoped `.eq("id", user.id)`.

Given `20261113000500`, there is no other way to store a Canvas token from the settings page. Please either add `/api/canvas/token` (session-verified, writes only the caller's own `canvas_token_encrypted` and `canvas_base_url`) to the allowlist in `BRIEF.md` and the decision log, or tell me to do it another way. I am proceeding on the assumption that you will allow it, since foundation's migration leaves no alternative.

Note for the record: `20261113000500` is not on `agent/pluto`, so CI still runs with the old permissive grants and a session-client version would pass CI while failing against the real database. Anything you can do to get that migration onto the integration branch early will stop other slices hitting the same trap.

## 2. The coder edited four files it does not own (I am reverting them)
Commit `044b420` also changed foundation-owned files, which its brief forbade:
- `apps/web/lib/env.ts`: removed `getServerEnv` and
- `apps/web/lib/env.server.ts`: new, re-exports it behind `import "server-only"`. This is a **sensible hardening** and I like it, but it changes an API that the mcp, assistant and web slices also import from `@/lib/env`, so it is not a canvas coder's change to make. If foundation wants it, foundation should do it once for everyone.
- `apps/web/lib/supabase/admin.ts`: edited the service-role allowlist comment, which is a policy statement and yours, not a coder's.
- `apps/web/package.json`: added a `test` script, plus a new `apps/web/vitest.config.ts` and `apps/web/test/**`. Giving `@pluto/web` a test runner is a real decision about the repo's test layout and belongs to foundation.

I have told the coder to revert all four and keep the service-role write using `createAdminClient()` exactly as it already exists, and to move its route tests into `packages/canvas`, which canvas owns and which already runs vitest. Then it gets its one re-review.

## What I need from you
1. A yes or no on the allowlist line for `/api/canvas/token` (item 1).
2. A decision, routed to foundation, on whether `getServerEnv` moves to a `server-only` module and whether `@pluto/web` gets its own vitest setup (item 2). Neither blocks me; both will keep coming up for other slices.
3. Nothing else. Canvas work continues meanwhile.
