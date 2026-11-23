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

   Run the reviewer on Sonnet. It uses less of the plan than Opus.

   **Stop rules** (keep plan usage bounded). A round is one review. After the last review, fix its blockers if the fix is cheap, but do not review again. Then open the PR and list any open blockers in its description. Stop at the first rule that applies:
   - **Round cap:** 3 reviews. Docs-only or skill-only diffs, or diffs under 30 lines: 1 review.
   - **No progress** (from round 2): the blocker count did not drop since the last round.
   - **Repeat:** a blocker that was fixed in any earlier round comes back. You check this by comparing every report so far. Fixer and reviewer disagree, so Ahmad decides.
   - **Usage limit:** a plan usage limit warning appears. Stop at once, commit what you have, and tell Ahmad. No PR.
4. Push and open the PR. The description says what changed, why, and the final review result (rounds, blockers fixed).
5. CI must pass. Ahmad merges, or says to.

This loop is for work done with Ahmad. Foreman's own stage agents (`foreman-build`, `foreman-review`) follow their skills, not this file, so that spec results stay comparable.

## Rules

- No Claude attribution in commits or PRs. Commits come from Ahmad.
- Never set `ANTHROPIC_API_KEY`. Never pass `--bare` to `claude`.
- Text Ahmad may paste elsewhere: no em dashes, straight apostrophes.
- Log failures in FAILURES.md and decisions in DECISIONS.md, in plain language.
- Keep replies short.
