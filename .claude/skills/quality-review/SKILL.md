---
name: quality-review
description: Strict code quality review of the current branch's diff against origin/main. Reports blockers that must be fixed before a pull request, and optional suggestions. Use before opening any pull request in this repo, or when asked for a quality review.
---

# Quality review

You review the diff of the current branch against `origin/main`. You do not edit code. You report.

For doc or skill changes, check that instructions are clear, short, and consistent with the README and the other skills. Apply the code lenses only where they fit.

## Steps

1. Run `git fetch origin`, then `git diff origin/main...HEAD`. Read every changed file in full, not just the hunks.
2. Read the code each change touches or calls, so you can judge where logic belongs and what already exists.
3. Run `npm run check`. If it fails, that is blocker 1 and you can stop.
4. Go through the three lenses below.
5. Write the report in the format at the end.

## Lens 1: Should this code exist? (Ponytail)

For each new function, file, type, or dependency, ask in order. Stop at the first yes.

1. Could it be dropped with no loss?
2. Does this repo already have it? (`src/` helpers, types, parsers)
3. Does Node's standard library have it?
4. Does an installed dependency have it?
5. Can it be one or two lines inline?

Only then is new code justified. If an earlier question is a yes and the diff adds new code anyway, that is a blocker.

## Lens 2: Structure (thermo-nuclear)

Look for a "code judo" move first: a restructure that deletes branches, helpers, or layers instead of rearranging them. Then check the blockers.

Blockers unless the diff justifies them clearly:

- A file pushed past 300 lines (this repo is small; keep files small).
- An ad-hoc `if` or special case added to an unrelated flow.
- A wrapper, helper, or abstraction that adds indirection without simplifying anything.
- `any`, unneeded casts, or optional fields that hide the real contract. Prefer the types in `src/types.ts`.
- Logic in the wrong layer: board code outside `src/board/`, agent code outside `src/agent/`, status changes anywhere but the runner.
- A near-duplicate of a helper that already exists.
- Copy-pasted logic that should be one function.
- A refactor that moves complexity around without reducing it.

## Lens 3: Root causes and slop (pstack)

Blockers:

- A fix that treats the symptom (retry, catch-and-ignore, special case) when the cause is visible and fixable.
- A silent fallback that hides a broken invariant. Fail loudly instead.
- A changed behaviour with no test, or a test weakened to pass.

Suggestions (never blockers):

- Comments that restate the code, AI filler in names, comments, or docs ("robust", "seamless", "comprehensive").
- Prose in README, DECISIONS.md, or FAILURES.md that is wordy. Plain, short sentences. No em dashes. Straight apostrophes.

## Rules

- Judge the diff, not the whole repo. Pre-existing problems go under "Noticed, not in this diff".
- Fewer, high-conviction findings beat a long list. No nits disguised as blockers.
- Every blocker names the file and line, what is wrong, and the concrete fix.
- If unsure whether something is a blocker, make it a suggestion.
- Do not fail working code on taste alone. A blocker must make the code harder to read, change, or trust.

## Report format

    QUALITY REVIEW
    Branch: <name>   Round: <n>

    Blockers (<count>):
    1. path/file.ts:42. <what is wrong>. Fix: <concrete change>.

    Suggestions (<count>):
    1. path/file.ts:10. <what>. <why>.

    Noticed, not in this diff:
    - <or "nothing">

    QUALITY: clean | blockers: <count>
