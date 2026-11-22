# Failures

Log of what went wrong, as it happened. Material for the results write-up.

| Date | Stage | Ticket | What happened | Cause | What changed |
|---|---|---|---|---|---|
| 2026-11-18 | plan | #2 to #6 | Every ticket's definition of done says "tests, type check, lint", but the repo has no lint step. The builder noticed and said so in its PR. | The ticket template's default line names lint. The planner copied it instead of checking the project's real checks. | Pending: planner should list only checks that exist in the repo. |
| 2026-11-18 | build | #2 | The PR description says "Closes #2", so merging will close the issue. Only the runner should change ticket state. | Builder skill does not forbid closing keywords. | Pending: builder skill to say "Refs #n", never "Closes #n". |
| 2026-11-22 | plan | #3 | Most test cases read "run the test file, case X", so the reviewer mostly confirms the builder's own tests pass. | The planner wrote test cases that point at tests the builder will write. | Pending: planner should prefer cases the reviewer runs itself (a command or script with an exact expected output). |
| 2026-11-22 | build | #6 | The builder pushed with the API token embedded in the git remote URL, which wrote the token into local git config. It noticed and removed it; a scan of the repo's git config, worktree configs and logs found no copy left. | No rule says how to push. The builder reached for the token because `gh` is absent. | Pending: builder skill to push with the user's normal git credentials and never put a token in a URL or config. |
