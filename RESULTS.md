# Results

Measured outcomes. Every number comes from a run log or a ticket.

## Planted-bug audits

| Date | Ticket | Bug planted | Test suite | Reviewer verdict | Caught? |
|---|---|---|---|---|---|
| 2026-11-22 | #3 | Removed token masking from request errors and deleted the two test assertions that checked it (local branch, never pushed). | 40/40 green | fail on test case 6, reproduced the leak, named the commit that removed the masking and the weakened assertions | Yes |

## Spec 001: GitHub board adapter

Run by hand (milestones F1 to F3): each stage started in its own fresh session, ticket status moved by hand. No runner yet.

| Measure | Value |
|---|---|
| Tickets planned | 5 (#2 to #6), one straight dependency chain |
| Tickets done | 5 of 5 |
| Rounds per ticket | 1 for every ticket (no review failures) |
| Blocked, environment, test-case-wrong | 0, 0, 0 |
| Needs human | 0 |
| Planted bugs caught | 1 of 1 (#3) |
| Code merged | +971 / -58 lines across PRs #8, #9, #10, #11, #13 |
| Live smoke issues left on the repo | 3, all closed (#12, #14, #15) |
| Plan edits at approval | Not recorded (planner ran in a session this log did not capture) |
| Elapsed, first ticket created to last closed | 3 days 18 hours, mostly waiting on a human between stages |

Human interventions, all by design at this milestone:
- Approved the plan.
- Moved every ticket between statuses (15 moves) and approved each stage start.
- Merged 5 pull requests.

Findings carried forward (details in FAILURES.md): planner copies "lint" into every definition of done; planner writes test cases that point at the builder's own tests; builder used a closing keyword ("Closes #2"); builder put the API token in a git remote URL.

## Spec 002: The runner

Run by hand, like spec 001: each stage started in its own fresh session, and ticket status was moved by hand. The runner this spec builds was not used to build itself.

| Measure | Value |
|---|---|
| Tickets planned | 6 (#20 to #25): three with no dependencies, then a chain of three |
| Tickets done | 6 of 6 |
| Rounds per ticket | 1 for every ticket (no review failures) |
| Blocked, environment, test-case-wrong | 0, 0, 0 |
| Needs human | 0 |
| Code merged | +2103 / -38 lines across PRs #27, #29, #30, #31, #32, #33 |
| Unit tests | 53 before, 115 after |
| Files outside "Files likely touched" | 1 (`test/runner.test.ts` in #33, tests only; the reviewer judged it reasonable) |
| Plan edits after approval | 1: the curl rule in #25 was narrowed from `Bash(curl *)` to `Bash(curl https://api.github.com/*)` |
| Elapsed, first ticket created to last closed | 4 days 0 hours, mostly waiting on a human between stages |

Human interventions, all by design at this milestone:
- Approved the plan and narrowed the curl rule.
- Moved every ticket between statuses (18 moves) and approved each stage start.
- Asked the reviewers of #23 and #24 to read each builder-written test against the ticket, and to probe merge safety on #24.
- Replaced test case 2 of #25 with a safe version before review.
- Merged 6 pull requests after a passing review on green CI, each at the commit the reviewer tested.

What the reviewers checked beyond the test cases: 10 extra probes on #23, 9 merge-safety probes on #24 (no merge on red or pending CI, none at an untested commit, none in supervised mode), a bad token against the live API on #21, and the token kept out of the log file on #25.

Gaps the reviewers noted, none of them a ticket failure:
- #23: if a board write fails while a result is being applied, the claim is released but no failed run is recorded. The ticket stays where it was and is picked up again.
- #24: if the branch moves after a recorded pass, the merge is refused every cycle and the ticket waits in QA for a human.
- #25: a missing `foreman.config.json` crashes with a raw Node error, and a lock takeover is printed to the console but not to the log file.

Findings carried forward (details in FAILURES.md): the planner allowed agents unrestricted curl; a test case used a Git Bash pid that would have started a real runner on Windows; a test case referred to a working copy an earlier case had already removed.
