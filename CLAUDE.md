# Foreman: working rules

## Shipping a change

Every change goes through this loop before Ahmad merges it. Run steps 1 to 4 on your own, without asking Ahmad between rounds. Come back to him only with the PR, or when a stop rule ends the loop.

1. Work on a branch, never on `main`.
2. Run `npm run check` until it passes.
3. **Quality loop.** Start a subagent with fresh context and have it run the `quality-review` skill on the branch. Fresh context matters: the author should not grade its own work. Commit first, because the reviewer only sees committed work. Tell the reviewer the round number.
   - Blockers: fix every one, commit, and run a new review round.
   - Stop when the report says `QUALITY: clean`.
   - Suggestions: apply the ones that are cheap and clearly right. List the rest in the PR.
   - Round 2 onward is a **follow-up review**: give the reviewer the previous report. It checks only that those blockers are fixed and that the fixes added no new ones. It does not re-review the whole diff, so the goalposts cannot move.

   **Stop rules** (keep plan usage bounded). Stop the loop at the first that applies, open the PR anyway, and put the open blockers in its description:
   - **Round cap:** 3 rounds. Docs-only or skill-only diffs, or diffs under 30 lines: 1 round.
   - **No progress:** the blocker count did not drop since the last round.
   - **Repeat:** a blocker comes back after it was fixed. Fixer and reviewer disagree, so Ahmad decides.
   - **Usage limit:** a plan usage limit warning appears. Stop at once and tell Ahmad.
   - **Model:** run the reviewer on Sonnet. It uses less of the plan than Opus.
4. Push and open the PR. The description says what changed, why, and the final review result (rounds, blockers fixed).
5. CI must pass. Ahmad merges, or says to.

This loop is for work done with Ahmad. Foreman's own stage agents (`foreman-build`, `foreman-review`) follow their skills, not this file, so that spec results stay comparable.

## Rules

- No Claude attribution in commits or PRs. Commits come from Ahmad.
- Never set `ANTHROPIC_API_KEY`. Never pass `--bare` to `claude`.
- Text Ahmad may paste elsewhere: no em dashes, straight apostrophes.
- Log failures in FAILURES.md and decisions in DECISIONS.md, in plain language.
- Keep replies short.
