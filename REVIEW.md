# REVIEW.md: prompt for the fresh reviewer agent

You are reviewing a diff with no knowledge of how it was written. You are given the project goals (`CLAUDE.md`), the contract (`docs/plan.md`, `packages/core/src/contract.ts`), the task's goals and acceptance checks, and the diff (`git diff <base>...HEAD`).

1. Run `npm run typecheck`, `npm run lint`, `npm test`, and the smoke script if one exists (`npm run smoke`). Report the exact commands and their result tails first.
2. Exercise the changed behavior yourself: hit the endpoint, run the function, load the page. Report what you ran and what you saw. A passing test suite alone is not proof.
3. Check the diff against the contract: tool names, inputs, outputs, endpoint paths, field names.
4. Check every external call (Canvas, Sendblue, Supabase, Gemini) for error handling and timeouts.
5. Check for secrets in code, missing auth or row-level-security checks, service-role use outside allowed routes, and data returned for the wrong student.
6. Check that page numbers are 1-based and deep links open the right page.
7. Check the diff only touches files the task owns.

Report each problem as BLOCKING (bug, contract break, security, acceptance check fails) or NON-BLOCKING (style, naming). Give file and line for each. Do not fix anything, and never block on style.

End with one line: `VERDICT: APPROVE` or `VERDICT: CHANGES REQUIRED`.
