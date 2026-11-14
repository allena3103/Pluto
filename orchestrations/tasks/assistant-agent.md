# Coder task: assistant-agent

Branch `agent/assistant-agent`, worktree `C:/Pluto-assistant-agent`, base and PR target `agent/assistant`. Port 3401 (no dev server unless you are checking something; stop it before you finish). No migration.

You are a Cursor coder on `grok-4.7-medium`. Follow `CLAUDE.md`, `orchestrations/files/BRIEF.md`, and `orchestrations/plans/assistant.md`. Build step 5. Contract items: the 7 tool names and their zod schemas (`TOOLS` in `packages/core/src/contract.ts`), `LlmMode`, citation shape `{ fileId, page, deepLink }`. Do not edit `docs/plan.md` or `packages/core/**`.

## Goal
`packages/agent` (`@pluto/agent`): one Gemini function-calling loop shared later by web chat and SMS, plus a deterministic mock that tests and demos use with no API key.

## You own
- `packages/agent/**`
- `package-lock.json`, only by running `npm install` from the repo root after you add dependencies
- the `GEMINI_MODEL` line in `.env.example` (set it to the model id you actually default to)

Edit nothing else. No `apps/web`. No new root scripts.

## Dependencies
`@pluto/agent` depends on `@pluto/core` (`*`), `zod` (`^4.6.7`), and `@google/genai` (current release; `gemini-4-hydrogen` was added in 3.3.0 on 2026-11-12). Declare them in `packages/agent/package.json`. Scripts: `typecheck` (`tsc -p tsconfig.json`), `lint` (`eslint .`), `test` (`vitest run`), matching `packages/core`. `tsconfig.json` extends `../../tsconfig.base.json` with `"types": ["node"]` and includes `src`, `test`, `vitest.config.ts`. Vitest include `test/**/*.test.ts`. No database setup file.

## Model
Confirm the recommended starting model at `https://ai.google.dev/gemini-api/docs/models` before you hard-code it. Default `GEMINI_MODEL` to `gemini-4-hydrogen` when that page still recommends it for everyday tool-using agents. If the page names a different current model id, use that id, set `.env.example` to it, and say so in the PR. Do not use `gemini-2.5-*` or a preview alias that the v1 API rejects. The sample model on the function-calling page is not our default.

Read the installed `@google/genai` types and `https://ai.google.dev/gemini-api/docs/function-calling`. Use the Interactions API: `GoogleGenAI`, `interactions.create`, `store: false`. Append the SDK's step objects unchanged when you send the next turn, so any signature fields stay intact. API key: `GEMINI_API_KEY`, read only when `llm` is `gemini`. Never log it. 20 second timeout on each model call (SDK signal or timeout if it has one, plus a `Promise` bound so a stuck call still returns). 10 second timeout on each tool call.

## API
Export from `packages/agent/src/index.ts`:

```ts
export const DEFAULT_GEMINI_MODEL: string;
export const MAX_TOOL_ROUNDS: 4;

export type AgentCitation = { fileId: string; page: number; deepLink: string };
export type AgentHistoryItem = { role: "user" | "assistant"; text: string };
export type AgentToolRunner = (name: string, args: unknown) => Promise<unknown>;
export type CreateMagicLink = (input: { fileId: string; page: number }) => Promise<{ url: string }>;

export function runAgent(input: {
  message: string;
  channel: "web" | "sms";
  history?: AgentHistoryItem[];
  ctx?: import("@pluto/core/context").ToolContext;
  runTool?: AgentToolRunner;
  createMagicLink?: CreateMagicLink;
  llm?: "mock" | "gemini";
  model?: string;
  signal?: AbortSignal;
}): Promise<{ text: string; citations: AgentCitation[]; magicLinkUrl?: string }>;
```

- `llm` defaults to `PLUTO_LLM` when that env var is `mock` or `gemini`, otherwise `mock`.
- `model` defaults to `GEMINI_MODEL` or `DEFAULT_GEMINI_MODEL`.
- When `runTool` is omitted, `ctx` is required and the runner is `TOOL_HANDLERS` from `@pluto/core/tools`. A tool name outside the 7 tools (and `create_magic_link`) returns an error result to the model; it does not throw.
- `create_magic_link` is declared to Gemini only when `createMagicLink` is passed. Args `{ fileId, page }` only. Ignore any student id the model sends. The host owns the student.
- Citations are collected from tool JSON, not from model prose. Walk objects and arrays. Keep an object when it has a uuid `fileId`, an integer `page` ≥ 1, and a `deepLink` string. That covers `search_notes` results, `get_note_pages` / `get_recent_notes` pages, and a top-level hit. Dedup by `fileId`+`page`, keep first-seen order.
- `runAgent` never throws. Tool failures, bad JSON, timeouts, and an empty model reply become a short safe sentence plus whatever citations were already collected. No stack traces, no secrets.

## Mock (`PLUTO_LLM=mock`)
No network. Exactly one tool call.

| Message (case insensitive) | Tool | Args |
| --- | --- | --- |
| contains `grade` | `get_grades` | `{}` |
| contains `due`, `deadline`, or `assignment` | `get_deadlines` | `{}` |
| contains `crunch`, `busiest`, or `heaviest` | `get_crunch_weeks` | `{}` |
| contains `course` and none of the above | `list_courses` | `{}` |
| otherwise | `search_notes` | `{ query: message trimmed to 500 chars, limit: 3 }`. If the message mentions `history 105` (any case), also `course: "History 105"`. |

Reply text:

- Search hit: `Found it in "<title>", page <page>.` Web channel may include the notes deep link. SMS channel stays under 300 characters, plain text, no markdown, and does not invent a URL.
- No hit: `I couldn't find that in your notes.`
- Grades, deadlines, crunch, courses: one plain sentence that uses a field from the tool result (course name, assignment title, or week start). No citation unless the result actually carried `fileId`/`page`/`deepLink`.
- Thrown tool: `Something went wrong while looking that up. Try again in a moment.`

When `channel` is `sms`, `createMagicLink` is set, and there is at least one citation, call it with the first citation and set `magicLinkUrl` to the returned `url`. Do not put that URL in the mock text; the route appends it.

## Gemini
System prompt: Pluto is this student's academic assistant. Use the tools for notes, grades, deadlines, courses, and crunch weeks. Never invent a page number or a URL. Pages are 1-based. For `sms`, keep the reply under 300 characters and plain text; the app appends the magic link. For `web`, a short answer is enough because citations are attached separately.

On a function call, run the tool and send the result back (truncate a tool result to 20_000 characters of JSON so a notes dump cannot fill the next request). Stop at 4 rounds, at `signal` abort, or when the model returns text and no function call. Then attach the collected citations. If the model asked for `create_magic_link` and the creator resolved, set `magicLinkUrl`.

Wrap the real SDK behind a small interface so tests pass a fake client. The fake test must not open a socket.

## Tests (all offline)
- Declarations: the 7 names match `TOOL_NAMES`. With a creator, the list also contains `create_magic_link` and does not ask the model for a student id. Without a creator, that tool is absent.
- Mock search: a fake `search_notes` returns one result whose deep link is `http://localhost:3401/notes/<uuid>?page=2`. `runAgent({ llm: "mock", channel: "web", message: "where are my notes about the treaty", runTool })` returns that file id, page 2, and a `deepLink` that `DeepLink` from `@pluto/core/contract` accepts. Page is ≥ 1.
- Mock SMS: same hit plus a creator that returns `{ url: "http://localhost:3401/open/test-token" }` sets `magicLinkUrl` to that URL and the text does not contain `open/test-token`.
- Mock routes the four keyword classes to the expected tool name.
- A thrown tool does not reject the promise.
- Fake Gemini client: first response is a `search_notes` function call, second is text. The runner is called once with the model's args. The second SDK request includes the tool result. Citations match the fake result. No network.

## Acceptance
From `C:/Pluto-assistant-agent`:

- `npm run typecheck`
- `npm run lint`
- `npm test`

All green. Paste the real output tails in the PR. `npm test` must pass with `PLUTO_LLM=mock` forced by the tests themselves (they pass `llm: "mock"` or a fake client). Do not call Gemini. Do not print `GEMINI_API_KEY`.

## Process
Commit small. `git push -u origin agent/assistant-agent` after every commit. Do not merge. Do not start a dev server and leave it running.

PR into `agent/assistant` using `.github/pull_request_template.md`. Body must include: build step 5; contract items (7 tool schemas, `LlmMode`, citation `{ fileId, page, deepLink }`); the model id and the docs URL you confirmed; the `npm install` packages you added; check output tails. This PR is not `security-review` (no migration, no route, no service role, no secret check).

How to UI-test: there is no page yet. Grokbot can read the mock test that cites page 2. Say that in the PR.

Reply `DONE` and the PR URL.
