// Live smoke test: runs GitHubBoard end to end against a real repo, then closes the issue it made.
// Usage: node src/scripts/smoke-board.ts owner/name
// Not part of `npm test`. Assumes Foreman's labels exist (see setup-labels.ts).
import { GitHubBoard } from "../board/github.ts";

const repo = process.argv[2];
const token = process.env.FOREMAN_GITHUB_TOKEN;
if (!token) {
  console.error("FOREMAN_GITHUB_TOKEN is not set");
  process.exit(1);
}
if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.error("usage: smoke-board.ts owner/name");
  process.exit(1);
}

const redact = (s: string) => s.split(token).join("***");

const body = `## Summary
Smoke test of the GitHub board adapter. Created and closed by src/scripts/smoke-board.ts.

## Context
Safe to ignore.

## Definition of done
- [ ] The smoke script finishes.

## Test cases
| # | Type | Steps | Expected result |
|---|------|-------|-----------------|
| 1 | check | Run the smoke script | Exits 0 |

## Dependencies
None

## Files likely touched
- none

## Out of scope
Everything else.
`;

const board = new GitHubBoard({ repo, token, claimTimeoutMin: 60 });

/** Closing is not part of BoardAdapter, so it is one direct PATCH. */
async function close(number: number): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${repo}/issues/${number}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "foreman",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state: "closed" }),
  });
  if (!res.ok) throw new Error(`closing #${number} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

let number: number | undefined;
try {
  const ticket = await board.create({ title: `Foreman smoke test ${new Date().toISOString()}`, body, status: "Backlog" });
  number = ticket.number;
  console.log(`created #${number}  https://github.com/${repo}/issues/${number}`);

  await board.move(number, "Ready", "smoke test");
  await board.move(number, "QA", "smoke test");
  await board.claim(number, "review", "smoke");
  console.log(JSON.stringify(await board.get(number), null, 2));

  await board.release(number, "smoke test");
  await board.setRound(number, 2);
  console.log(JSON.stringify(await board.get(number), null, 2));

  await close(number);
  console.log(`closed #${number}`);
} catch (e) {
  console.error(redact(`smoke test failed: ${(e as Error).message}`));
  if (number !== undefined) {
    await close(number).catch((err: Error) => console.error(redact(err.message)));
    console.error(`closed #${number} after failure`);
  }
  process.exit(1);
}
