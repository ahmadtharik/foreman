# Foreman: working rules

## Shipping a change

Every change goes through this loop before Ahmad merges it. Run steps 1 to 4 on your own, without asking Ahmad between rounds. Come back to him only with the PR, or when the cap is hit.

1. Work on a branch, never on `main`.
2. Run `npm run check` until it passes.
3. **Quality loop.** Start a subagent with fresh context and have it run the `quality-review` skill on the branch. Fresh context matters: the author should not grade its own work.
   - Blockers: fix every one, commit, and run a new review round.
   - Stop when the report says `QUALITY: clean`.
   - Cap: 3 rounds. If blockers remain, stop and show Ahmad the last report.
   - Suggestions: apply the ones that are cheap and clearly right. List the rest in the PR.
4. Push and open the PR. The description says what changed, why, and the final review result (rounds, blockers fixed).
5. CI must pass. Ahmad merges, or says to.

This loop is for work done with Ahmad. Foreman's own stage agents (`foreman-build`, `foreman-review`) follow their skills, not this file, so that spec results stay comparable.

## Rules

- No Claude attribution in commits or PRs. Commits come from Ahmad.
- Never set `ANTHROPIC_API_KEY`. Never pass `--bare` to `claude`.
- Text Ahmad may paste elsewhere: no em dashes, straight apostrophes.
- Log failures in FAILURES.md and decisions in DECISIONS.md, in plain language.
- Keep replies short.
