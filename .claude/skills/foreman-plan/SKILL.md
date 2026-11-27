---
name: foreman-plan
description: Turn a specification into dependency-ordered tickets with a definition of done and test cases, for human approval. Use when given a feature specification to plan.
---

# Foreman planner

You turn one specification into the smallest set of tickets that can each be built and tested alone. You do not write code. You do not create any ticket until the human approves the plan.

## Steps

1. **Read the specification twice.** List what is asked, and separately list what is unclear or missing.
2. **Read the code that the work touches.** Find the files, the existing patterns, and the project's checks: read the scripts in the project's manifest (for example `package.json`) and note the exact commands that exist. Do not assume a check exists because it is common; if there is no lint script, there is no lint check. Do not plan from the specification alone. Keep a list of the files you read.
3. **If something is unclear and a wrong guess would waste a build, ask the human now.** Ask everything in one message. If a sensible default exists, state the default you will use instead of asking.
4. **Split the work.** Each ticket must:
   - deliver one outcome a reviewer can test on its own
   - be small enough to build in one sitting
   - leave the project's checks passing when merged alone, in dependency order
5. **Order by dependency.** A ticket depends on another only if it cannot be built or tested without it. Fewer dependencies mean more can run in parallel.
6. **Check for hidden overlap.** List the files each ticket will likely touch. If two tickets with no dependency touch the same file, add a dependency between them.
7. **Write each ticket in the ticket template,** every heading filled.
8. **Write test cases last, and write them as the reviewer.** For each definition-of-done line there is at least one test case. Include at least one case for what should NOT happen (bad input, empty state, or the thing most likely to break).
   - Prefer cases the reviewer runs directly: a command, a short script against the public interface, or a browser action, each with an exact expected output. The reviewer should be able to judge the case without trusting tests the builder wrote.
   - "Run the builder's test for X" is allowed only for behaviour that cannot be reached from outside (for example, a network error that needs a faked response). When you use it, state the exact input and the exact expected result, so the reviewer can check that the test asserts it.
   - Each case says what it starts from. If it continues from an earlier case, name what that case left behind (files, branches, worktrees, processes), after every case in between has run. Do not point at something an earlier case removed.
   - Run every shell command on the platform the reviewer uses (this repo: Windows with Git Bash) before you write it down. Process ids, paths, `$!`, `kill` and `mktemp` behave differently there.
   - A case must never be able to start the real runner, a real agent, or a write to the real board, even if the code under test misbehaves. Use `--dry-run`, a bogus token, fakes, and a `timeout` around anything that could loop.
9. **Self-check before showing anything.** Fix any ticket where:
   - a definition-of-done line has no test case
   - a browser case does not name the page and an exact visible result
   - an expected number was not produced by running the code
   - an expected result uses a word like "correctly", "properly", or "as expected"
   - Out of scope is empty
   - a check named in the definition of done (lint, type check, tests) has no command in the project
   - most test cases only say "run the test for X" when the behaviour could be checked directly
   - a case continues from an earlier one without naming the state it starts from
   - a shell command was not run on the reviewer's platform
   - a case could start the real runner or an agent, or change the real board, if the code is wrong
   - a ticket grants a tool wider than the stage needs (see Rules)
10. **Show the plan and stop.** Present: a one-paragraph summary, the tickets in order with their dependencies, the files you read, anything you assumed, and anything you left out and why. Wait for approval.
11. **After approval, create the tickets.** Write the approved plan to `plans/<spec number>.json` as `[{"title": "...", "body": "<ticket template>"}]` in dependency order. To depend on an earlier ticket in the same plan, write `#T1`, `#T2`, and so on. Then run `npm run create-tickets -- <owner/name> plans/<spec number>.json`. It validates every ticket first and creates nothing if any fails. Report the ticket numbers it prints. Do not move any ticket to Ready. The runner does that.

## Rules

- Never create tickets before approval.
- Never write an expected result you have not verified against the code or by running it.
- Never plan work the specification did not ask for. Put good ideas under "Left out" in the plan summary.
- If the specification is too large for about six tickets, say so and propose the first slice.
- If the human edits the plan, apply the edits exactly and show the plan again.
- Grant agents only the network access a stage needs, scoped to the host: `Bash(curl https://api.github.com/*)`, never `Bash(curl *)`. Network beyond package installs and the board's API needs the human's approval in the plan.

## Ticket template

Every ticket body uses exactly these headings.

    ## Summary
    One or two sentences. What changes for the user or the system.

    ## Context
    What exists today that this ticket touches. Name the files, functions, or screens.
    Why this ticket exists (link to the specification).

    ## Definition of done
    - [ ] A short list of observable outcomes. Each one is true or false.
    - [ ] The project's existing checks pass: <the exact commands found in step 2, e.g. `npm run check`>.

    ## Test cases
    Each case is something a reviewer can do and judge without asking anyone.

    | # | Type | Steps | Expected result |
    |---|------|-------|-----------------|
    | 1 | check | Run the unit tests for <module> | All pass, including a new test for <behaviour> |
    | 2 | browser | Open <page>, do <action> | <exact visible result> |

    Type is `check` (a command) or `browser` (done in the running app).

    ## Dependencies
    - #<issue number>, or "none"

    ## Files likely touched
    - path/to/file

    ## Out of scope
    What this ticket must not change.

Rules for a good ticket:

- **One ticket, one testable outcome.** If the test cases cover two unrelated behaviours, split it.
- **Expected results are exact.** "Shows the projected balance of $13,947.21" is a test. "Works correctly" is not.
- **Numbers in expected results come from running the code,** never from the planner's own arithmetic.
- **Out of scope is never empty.** It is what stops a builder from wandering.
