# Spec 001: GitHub board adapter

## Goal

Foreman can read and change tickets on a GitHub repo through the `BoardAdapter` interface in `src/board/types.ts`. This is the first real implementation of that interface. The runner (F4) and the planner's "create tickets" step will use it.

## What it must do

- **Create** an issue from a title and a body in the ticket template, with one status label.
- **Get** one issue by number and return a `Ticket`: parsed body, status, round, claim.
- **List** open issues that carry a status label, optionally filtered by status.
- **Move** a ticket: replace its status label with the new one, and post a comment saying from, to, and why.
- **Claim** a ticket for a stage: add the `foreman: claimed` label and a comment recording who claimed it, for which stage, and when. Claiming a ticket that already has a fresh claim fails.
- **Release** a claim: remove the label and post a comment with the reason.
- **Set round**: record the round number so it survives a restart.
- **Comment**: post a plain comment.

## Constraints

- State lives on GitHub only: labels and comments. No local database.
- Status labels and the claim label are defined in `src/board/labels.ts`. Do not invent others.
- Machine-readable comments (claim, round, move) must be parseable back, so `get` can rebuild the claim and the round from comments alone.
- Use Node's built-in `fetch` against the GitHub REST API. No new runtime dependencies. No `gh` CLI.
- The token comes from `FOREMAN_GITHUB_TOKEN`. Never log it.
- Unit tests must not call the network. Fake `fetch` in tests.
- A ticket whose body does not match the template is still returned by `list`, flagged as unparseable, not dropped and not a crash.

## Out of scope

- GitHub Projects board sync (needs a separate token, later).
- Webhooks.
- The runner loop itself.
- Any change to the ticket template or the result block.

## How we will know it works

- Unit tests cover each method with a fake `fetch`, including: claim on an already-claimed ticket, a stale claim, an unparseable body, a ticket with no status label.
- A short script creates a test issue on `ahmadtharik/foreman`, moves it through two statuses, claims and releases it, prints what `get` returns, and closes it.
