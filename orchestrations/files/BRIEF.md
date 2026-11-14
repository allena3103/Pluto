# Pluto shared brief (all orchestrators and coders)

## Goal
In Claude, a student types "build me a study guide from my History 105 notes from the past 2 weeks, use Pluto", and Claude pulls the real notes through the Pluto MCP and writes the guide with page citations. Web chat, SMS and alerts reuse the same core. Full scope and contract: `docs/plan.md`.

## Allen's priorities (in order)
1. The demo path works end to end: seeded demo student -> notes searchable by page -> MCP in Claude -> study guide with deep links that open the exact PDF page.
2. Nothing leaks across students (RLS + explicit `student_id` filters, tested).
3. Every surface (MCP, web chat, SMS) behaves the same because it calls the same `packages/core` functions.
4. Polish only after 1-3 work. Cut from the bottom of the build order if time runs short.

## Timeline (revised Sat 10:00 EST; submission ~Sun 2026-11-15 09:00 EST). Cut from the bottom.
| Target (EST) | Milestone | Owner |
| --- | --- | --- |
| Sat 12:00 | F2 (ingest, helpers, tool fixes) on `agent/pluto`; first Vercel deploy from `main` | foundation, director |
| Sat 14:00 | Claude connected via the demo URL token; study guide with page citations works on the deployed app; backup video | mcp |
| Sat 17:00 | Web: notes viewer, `/open` magic links, chat with Gemini, sign-up | web, assistant |
| Sat 19:00 | SMS round trip, phone linking, crunch-week alert, ICS feed | assistant |
| Sat 21:00 | OAuth sign-in for Claude, then the ChatGPT test | mcp |
| Sat 23:00 | Live Canvas sync with Allen's token, deadline-change alert | canvas |
| Sun 01:00 | Sign-up polish, PWA, loading and error states | web |
| Sun 03:00 | Feature freeze. Bugs, rehearsal, recordings only | all |

Integration cadence: every planner opens a milestone PR into `agent/pluto` about every 2 hours, or as soon as a row above works on its branch. Grokbot merges milestone PRs with a merge commit (not squash). After each one, the director runs the full checks and smoke on `agent/pluto` and opens an `agent/pluto` -> `main` PR; Allen merges it, which deploys to Vercel.

Foundation retires after its F2 milestone merges; from then on the director owns `packages/core/**`, `supabase/config.toml`, CI and root configs. Request changes through the director.

## Stack
- npm workspaces monorepo, TypeScript strict, Node 24. No pnpm/bun.
- `apps/web`: Next.js (App Router) on Vercel, Tailwind + shadcn/ui, PWA. Hosts UI, internal API routes and the MCP endpoint `/api/mcp`.
- `packages/core`: `contract.ts` (zod schemas for all 7 tools and 10 endpoints), data-access functions for every tool, deep links, magic links, ingest, crunch weeks. Every surface calls these.
- `supabase/`: migrations, `seed.sql`, `config.toml`. Postgres FTS, one row per PDF page. Storage bucket for PDFs.
- MCP: TypeScript MCP SDK, streamable HTTP, Supabase Auth OAuth 2.1 server (dynamic client registration, consent at `/oauth/consent`), fallback bearer `PLUTO_DEMO_MCP_TOKEN`.
- Agent: Google Gemini API (`@google/genai`) function-calling loop, model from `GEMINI_MODEL`.
- SMS: Sendblue sandbox; simulator fallback.
- Calendar: ICS feed `/cal/:token.ics`.

## Ownership map (who may edit what)
| Owner | Paths |
| --- | --- |
| foundation | root configs, `package.json` (root), CI, `supabase/**` (its range), `packages/core/**`, `apps/web` scaffold, `apps/web/lib/supabase/**`, `apps/web/middleware.ts`, `apps/web/app/api/ingest/**`, `scripts/**`, `seed/**` |
| web | `apps/web/app/(app)/**` (except sub-paths below), `apps/web/app/login/**`, `apps/web/app/open/**`, `apps/web/app/api/grades/**`, `apps/web/components/**` (except `components/sms-sim/**`), `apps/web/public/**`, PWA manifest |
| canvas | `packages/canvas/**`, `apps/web/app/api/canvas/**`, `apps/web/app/(app)/settings/canvas/**`, `apps/web/app/api/alerts/deadline-change/**` |
| mcp | `packages/mcp/**`, `apps/web/app/api/mcp/**`, `apps/web/app/.well-known/**`, `apps/web/app/oauth/**` |
| assistant | `packages/agent/**`, `apps/web/app/api/{chat,agent,magic-link,sms}/**`, `apps/web/app/api/alerts/demo/**`, `apps/web/app/cal/**`, `apps/web/app/(app)/sms-sim/**`, `apps/web/components/sms-sim/**` |

After F2, `packages/core/**` is owned by the director: request changes, don't edit. Each package/app keeps its own `package.json`; add deps only to the one you own. Lockfile conflicts are resolved by the director with `npm install`.

## Parallel-safety assignments
| Orchestrator | Branch / worktree | Dev port (coders +1..+9) | Migration range |
| --- | --- | --- | --- |
| foundation | `agent/foundation` / `C:/Pluto-foundation` | 3000 | `20261113000000`-`20261113235959` |
| web | `agent/web` / `C:/Pluto-web` | 3100 | `20261114010000`-`20261114015959` |
| canvas | `agent/canvas` / `C:/Pluto-canvas` | 3200 | `20261114020000`-`20261114025959` |
| mcp | `agent/mcp` / `C:/Pluto-mcp` | 3300 | `20261114030000`-`20261114035959` |
| assistant | `agent/assistant` / `C:/Pluto-assistant` | 3400 | `20261114040000`-`20261114045959` |

Coders: branch `agent/<orch>-<task>`, worktree `C:/Pluto-<orch>-<task>`, based on the orchestrator branch.

## Local environment and testing without real keys
- One shared local Supabase stack (Docker) for everyone. Apply your new migrations with `npx supabase migration up`. Never `db reset` (director only). Tests create their own users with unique emails and clean up after themselves.
- Docker Desktop is running (engine 29.9.3). If `docker` is not on PATH in your shell, prepend `/c/Program Files/Docker/Docker/resources/bin` (Git Bash) or `C:\Program Files\Docker\Docker\resources\bin`.
- `npm run env:local` (built by foundation) writes `apps/web/.env.local` from `npx supabase status -o env`, your port, and `C:/Pluto/.env.secrets` if present (Allen fills real keys there; never copy it into a repo).
- Mocks when keys are missing: `PLUTO_LLM=mock` (deterministic scripted tool calls), `SMS_PROVIDER=simulator` (messages stored and shown in `/sms-sim`), `CANVAS_MODE=fixtures` (recorded JSON in `packages/canvas/fixtures`).
- Seed: demo student `demo@pluto.test` and a second student `other@pluto.test` (password in `.env.example`), History 105 and two more courses, synthetic lecture PDFs with selectable text, one seeded due-date change.

## Security rules
- RLS on every table; every policy keyed on `auth.uid()`. Core functions also filter by `student_id` explicitly.
- Service role only in: `/api/ingest`, `/api/sms/inbound`, `/api/alerts/*`, `/api/canvas/*` cron/sync, `/open/:token`, MCP demo-token fallback, and the MCP `save_study_guide` text step (after auth). Each verifies a secret, signature or token first.
- MCP tools are read-only except `save_study_guide`, which only adds a saved note for the signed-in student and texts that student (`docs/plan.md`, "MCP contract").
- No secrets, tokens or real PDFs in git. Canvas tokens encrypted at rest (AES-256-GCM, key `CANVAS_TOKEN_KEY`).
- Magic links: single use, expire in 15 minutes, bound to one student and one target (a file page, or a saved note for `save_study_guide` texts).

## Final report (every orchestrator, to the director, as `orchestrations/reports/<orch>-<milestone>.md` in its PR)
1. What is done, mapped to build steps and done-when checks.
2. Contract items touched.
3. Checks run, with real output tails (typecheck, lint, test, smoke, manual exercise).
4. Reviewer verdicts per coder PR and how blocking items were resolved.
5. Open issues, risks, and decisions needed from the director or Allen.
6. How grokbot should UI-test it (URLs, login, clicks, expected result).
