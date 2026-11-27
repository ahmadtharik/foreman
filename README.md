# Foreman

Foreman lets one developer direct a team of AI agents through plan, build and review, using a GitHub Projects board as the shared workspace.

Status: F0 (setup). Not yet run end to end.

## How it works

1. **Planner** (skill `foreman-plan`, interactive): turns a specification into dependency-ordered tickets with a definition of done and test cases. A human approves before any ticket is created.
2. **Builder** (skill `foreman-build`): builds one ticket in its own git worktree, opens a pull request, ends with a result block.
3. **Reviewer** (skill `foreman-review`): tests the ticket against its own test cases, reports pass or fail with evidence.
4. **Runner** (`src/`, F4): watches the board, starts agents, reads result blocks, moves tickets. Only the runner changes ticket status.

## Layout

| Path | What |
|---|---|
| `.claude/skills/` | The three stage skills (`foreman-*`), plus `quality-review` for work on this repo. For another target repo, copy only the `foreman-*` skills. |
| `specs/` | Specifications fed to the planner. |
| `src/board/labels.ts` | Status and claim labels. Create them with `npm run setup:labels -- owner/name`. |
| `src/types.ts` | Statuses, results, ticket shape. |
| `src/ticket.ts` | Parses and lints the fixed ticket template. |
| `src/result.ts` | Parses the `FOREMAN-RESULT` block. |
| `src/config.ts` | Settings and the stage table (stages are data). |
| `src/board/` | Board adapter interface (GitHub first). |
| `src/agent/` | Agent adapter interface and the Claude Code implementation. |

## Run

Requires Node 24+ and Claude Code signed in with a Claude plan. Do not set `ANTHROPIC_API_KEY`.

```
npm install
npm run check          # type check + unit tests
npm run check:claude   # confirms a non-interactive run works on the plan
```

## Runner

Needs `foreman.config.json` (copy `foreman.config.example.json`) and `FOREMAN_GITHUB_TOKEN`.

```
npm run runner -- --dry-run   # one cycle: prints what it would do, changes nothing
npm run runner                # runs a cycle every pollIntervalSec until stopped
```

Only one runner runs at a time (`foreman.lock`). Each action is logged to the console and to `logs/runner-<date>.log`.

## Development workflow

- Work on a short branch (`f1-planner`, `fix-result-parser`), never directly on `main`.
- Run `npm run check` before pushing.
- Run the quality loop: a fresh reviewer runs the `quality-review` skill, blockers get fixed, repeat until clean (max 3 rounds). See `CLAUDE.md`.
- Open a pull request. CI (`.github/workflows/ci.yml`) runs the type check and unit tests.
- Squash-merge when CI is green. `main` is protected and requires the `check` job.
- CI never runs Claude. Agent runs stay on the local machine, on the Claude plan.
