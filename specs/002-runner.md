# Spec 002: The runner

## Goal

A command, `npm run runner`, that moves approved tickets from Ready to Done with no manual starts. It replaces what a human did by hand for spec 001: moving labels, starting a builder or reviewer in a fresh working copy, reading the result block, and merging the pull request after a passing review.

## What it must do

**Cycle.** Every `pollIntervalSec`, the runner:
1. Promotes Backlog tickets to Ready when every dependency is Done.
2. Releases claims older than `claimTimeoutMin`, with a logged reason.
3. Picks at most one eligible ticket per stage (default limits: 1 builder, 1 reviewer). A ticket is eligible when its status is one of the stage's triggers in the stage table (`src/config.ts`), it has no fresh claim, and its dependencies are Done.
4. Claims it, runs the stage's agent, reads the result, applies the transition from the stage table, and releases the claim.

**Running an agent.**
- Each run uses its own git worktree for the ticket, cut from the latest `origin/main`. A returned ticket reuses its existing branch (the one its pull request is on).
- The agent is Claude Code through the existing `AgentAdapter` (`src/agent/claude-code.ts`), with the stage's skill.
- The agent's environment is scrubbed by `src/agent/env.ts`, except `FOREMAN_GITHUB_TOKEN`, which the builder and reviewer need for the GitHub API.

**Results.** The runner applies the stage table, plus these rules:
- `pass` is accepted only if the reviewer's report comment on the ticket has one row per test case in the ticket, each with evidence. Otherwise it is rejected, logged, and the review is queued again.
- `fail` adds a round. A ticket that reaches `maxRounds` moves to Needs human instead of back to In progress.
- `environment` does not add a round. The ticket stays in QA and is retried on a later cycle.
- A plan usage limit marks the ticket Paused, adds no round, and the runner resumes Paused tickets on a later cycle.
- A run with no valid result block, or a crash, releases the claim and leaves the status unchanged. Three in a row for the same ticket moves it to Needs human.

**After a build.** Before moving a ticket to QA, the runner compares the pull request's files with "Files likely touched". Files outside the list are named in a comment on the ticket for the reviewer. A diff larger than `maxDiffLines` moves the ticket to Needs human.

**After a passing review.** If CI is green on the commit the reviewer tested, the runner squash-merges the pull request (passing that commit's SHA) and moves the ticket to Done. If CI is red or still running, it waits and checks again on a later cycle. In `supervised` mode it does not merge; it moves the ticket to Done only after a human has merged.

**Safety and state.**
- Only one runner at a time, enforced with a lock file. A second runner exits with a clear message.
- All state lives on GitHub (labels and comments). Killing the runner and starting it again loses nothing: it carries on from the tickets.
- Every action writes one log line with the ticket, the action and the reason, to the console and to a file under `logs/`.
- The token never appears in logs, comments, or output.

## Constraints

- TypeScript run by Node 24 with no build step, like the rest of the repo. No new runtime dependencies.
- Pull request operations the runner needs (find a ticket's pull request, list its files and diff size, read CI status for a commit, squash-merge) go through GitHub's REST API with `FOREMAN_GITHUB_TOKEN`, alongside the existing board adapter. No `gh` CLI.
- Agent runs bill to the Claude plan. Never set or pass an API key.
- Unit tests must not start Claude Code or call the network: fake the board, the agent, git, and `fetch`.
- Settings come from `foreman.config.json` (example in `foreman.config.example.json`), validated by `src/config.ts`.

## Out of scope

- Running more than one builder or reviewer at once (milestone F6).
- Starting an app or running browser tests before review (Foreman has no app; add it with the first target that does).
- The run report page (milestone F5).
- Webhooks, a UI, or a Projects board.
- The planner stage: planning stays interactive.

## How we will know it works

- Unit tests with fakes cover: promotion from Backlog, picking only eligible tickets, every result and rule above, the round cap, the evidence check, a stale claim, a second runner refused by the lock, and a restart in the middle of a ticket.
- A dry-run flag that prints what the runner would do on the real repo, without claiming, running agents, or changing anything.
- Final check, done by a human after these tickets merge: one small specification goes from approved plan to Done with the runner alone.
