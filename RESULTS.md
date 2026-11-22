# Results

Measured outcomes. Every number comes from a run log or a ticket.

## Planted-bug audits

| Date | Ticket | Bug planted | Test suite | Reviewer verdict | Caught? |
|---|---|---|---|---|---|
| 2026-11-22 | #3 | Removed token masking from request errors and deleted the two test assertions that checked it (local branch, never pushed). | 40/40 green | fail on test case 6, reproduced the leak, named the commit that removed the masking and the weakened assertions | Yes |
