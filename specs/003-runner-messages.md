# Spec 003: Clearer runner start-up messages

## Goal

Two small gaps the reviewer of #25 found in `npm run runner`. This spec is also the F4 final check: it goes from approved plan to Done with the runner alone, with no manual label moves, stage starts or merges.

## What it must do

**Missing or bad config.** When `foreman.config.json` is missing, the runner prints one line and exits 1, with no stack trace:
`foreman.config.json not found. Copy foreman.config.example.json and edit it.`
When the file is not valid JSON, it prints `foreman.config.json is not valid JSON: <parser message>` and exits 1. When `validate` rejects the settings, it prints the validation errors and exits 1. This holds for `--dry-run` too.

**Lock takeover in the log.** When the runner takes over a lock left by a dead process, the takeover line goes to the log file under `logs/` as well as the console, with the action `lock` and the old pid in the reason.

## Constraints

- Same as spec 002: TypeScript run by Node 24 with no build step, no new runtime dependencies, no network or Claude Code in unit tests.
- The config path stays `foreman.config.json` in the working directory.
- Never print or log the token.

## Out of scope

- Any change to the cycle, the stage table, the board, or the agents.
- New settings, or a config path flag.
- Log rotation or log format changes beyond the new `lock` line.

## How we will know it works

- Running the runner in a folder with no `foreman.config.json`, with a broken one, and with one that fails validation each prints the one-line message above and exits 1.
- A lock file holding a dead pid is taken over, and the takeover line appears in the day's log file.
- Final check: the runner, started once by a human, takes these tickets from Ready to Done and merges their pull requests, with no other human action.
