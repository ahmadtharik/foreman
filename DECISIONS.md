# Decisions

Plain-language record of the main choices and why.

## 2026-11-17: TypeScript run directly by Node 24, no build step

Node 24 runs `.ts` files natively by stripping types. So there is no compile step and only two dev dependencies (`typescript` for the type check, `@types/node`). The cost: no TypeScript-only syntax such as enums or constructor parameter properties. `erasableSyntaxOnly` in tsconfig enforces that.

## 2026-11-17: Tests use Node's built-in test runner

`node --test` needs no extra library. Enough for parsers and the runner's state logic.

## 2026-11-17: Agents run with `claude -p`, prompt sent on stdin

Sending the ticket body on stdin avoids shell quoting problems on Windows and command-line length limits.

Never use `--bare`. In Claude Code 2.1.311 it forces API-key auth, which would break the cost rule.

## 2026-11-17: The agent environment is scrubbed, not trusted

`src/agent/env.ts` removes `ANTHROPIC_API_KEY` and anything that looks like a token or secret before starting an agent. A scoped repo token can be kept only by naming it on purpose. Unit tested.

## 2026-11-17: Result blocks are parsed strictly

A missing or malformed `FOREMAN-RESULT`, a result that does not belong to the stage (a builder saying `pass`), or a fail without a reason is rejected. The runner never guesses a result. The block format was added to the builder and reviewer skills themselves, because the agents cannot see the draft document.

## 2026-11-17: Stages are a table, not code

`src/config.ts` maps each stage's results to a transition (move to a status, or retry). A new stage is a new table entry. Two rules sit in the runner on top of the table: a pass without evidence is rejected, and a fail at the round cap goes to Needs human.

A returned ticket sits in "In progress" with no claim. That is how the builder trigger tells "waiting for a fix" apart from "being built".

## 2026-11-17: Branch, pull request, CI, squash merge

Every change goes through a pull request, so the repo's history shows the same discipline Foreman asks of its agents. CI is one GitHub Actions job on Ubuntu: `npm ci`, type check, unit tests. It takes about a minute and uses only free Actions minutes.

Left out on purpose:
- No Windows runner yet. The tests do not spawn processes, so Ubuntu catches the same failures. Add Windows when runner code that spawns `claude` gets tests.
- No Claude in CI. It would need a login or an API key, and the cost rule rules out the API key. Agent runs are tested locally.
- No lint step yet. The type check in strict mode covers most of it. Add ESLint if style drift shows up.

## 2026-11-17: `total_cost_usd` is reported on the plan too

The smoke check showed Claude Code reports a dollar figure even when signed in with the plan. It is an estimate, not a charge. Useful later as a rough "effort" number in run reports.
