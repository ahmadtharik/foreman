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
