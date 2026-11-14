## Summary

## Build step and contract items touched

## Checks (real output tails)
- typecheck:
- lint:
- test:
- smoke (if it exists):

## Merge gate (for grokbot)
- [ ] CI `check` is green on the latest commit
- [ ] Label `security-review`? If yes, fresh review verdict: `VERDICT: APPROVE` (link the review comment)
- [ ] Only files this task owns were changed

Do not merge while CI is red or a `security-review` PR lacks an APPROVE verdict.

## How to UI-test (for grokbot)
Preview URL, login (`demo@pluto.test`), clicks, and expected result.
