# Failures

Log of what went wrong, as it happened. Material for the results write-up.

| Date | Stage | Ticket | What happened | Cause | What changed |
|---|---|---|---|---|---|
| 2026-11-18 | plan | #2 to #6 | Every ticket's definition of done says "tests, type check, lint", but the repo has no lint step. The builder noticed and said so in its PR. | The ticket template's default line names lint. The planner copied it instead of checking the project's real checks. | Pending: planner should list only checks that exist in the repo. |
| 2026-11-18 | build | #2 | The PR description says "Closes #2", so merging will close the issue. Only the runner should change ticket state. | Builder skill does not forbid closing keywords. | Pending: builder skill to say "Refs #n", never "Closes #n". |
