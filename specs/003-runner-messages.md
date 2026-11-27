# Spec 003: Clearer runner start-up messages

## Goal

Two small gaps the reviewer of #25 found in `npm run runner`. This spec is also the F4 final check: it goes from approved plan to Done with the runner alone, with no manual label moves, stage starts or merges. That check is about how the spec is run, not a ticket of its own.

## What it must do

**Missing or bad config.** The runner checks `FOREMAN_GITHUB_TOKEN` first, as it does today, then loads `foreman.config.json`. Each failure below prints its message, with no stack trace, and exits 1. The same applies with `--dry-run`.
- File missing: one line, `foreman.config.json not found. Copy foreman.config.example.json and edit it.`
- File not valid JSON: one line, `foreman.config.json is not valid JSON: <parser message>`.
- Settings rejected by `validate` in `src/config.ts`: its existing `Invalid settings:` list, one line per error, as it reads today.
Other read errors (for example a permission error) print one line, `cannot read foreman.config.json: <message>`.

**Lock takeover in the log.** When the runner takes over a lock left by a dead process, it writes a log line with the action `lock` and the old pid in the reason, so the line reaches the day's file under `logs/` as well as the console. The existing console warning may be replaced by this log line, since the log also prints to the console. `acquireLock` in `src/runner/lock.ts` has no access to the log today. Pass the log function in as an optional parameter. Do not add a global.

## Constraints

- TypeScript run by Node 24 with no build step. No new runtime dependencies.
- Unit tests must not start Claude Code or call the network.
- The config path stays `foreman.config.json` in the working directory.
- Never print or log the token.

## Out of scope

- Any change to the cycle, the stage table, the board, or the agents.
- New settings, or a config path flag.
- Shape checks on the parsed JSON beyond what `validate` already does.
- Log rotation or log format changes beyond the new `lock` line.

## How we will know it works

- With the token set, running the runner in a folder with no `foreman.config.json` and with a broken one each prints its one-line message and exits 1. With a config that fails validation, it prints the `Invalid settings:` list and exits 1.
- A lock file holding a dead pid is taken over, and a `lock` line naming that pid appears in the day's log file.
- Final check, done by a human: the runner, started once, takes these tickets from Ready to Done and merges their pull requests, with no other human action.
