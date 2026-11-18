import { test } from "node:test";
import assert from "node:assert/strict";
import { lintTicket, parseTicket, TicketParseError } from "../src/ticket.ts";

const good = `## Summary
Show the projected balance.

## Context
src/calc.ts computes it. Spec: #1

## Definition of done
- [ ] The summary card shows the projected balance
- [ ] The project's existing checks pass (tests, type check, lint).

## Test cases
| # | Type | Steps | Expected result |
|---|------|-------|-----------------|
| 1 | check | Run npm test | All pass, including a new test for projection |
| 2 | browser | Open /plan, click Project | Card shows "$13,947.21" |

## Dependencies
- #3, #5

## Files likely touched
- \`src/calc.ts\`
- src/ui/Card.tsx

## Out of scope
Changing the interest formula.
`;

test("parses every section of a well-formed ticket", () => {
  const t = parseTicket(good);
  assert.equal(t.definitionOfDone.length, 2);
  assert.equal(t.testCases.length, 2);
  assert.equal(t.testCases[1]!.type, "browser");
  assert.deepEqual(t.dependencies, [3, 5]);
  assert.deepEqual(t.filesLikelyTouched, ["src/calc.ts", "src/ui/Card.tsx"]);
  assert.deepEqual(lintTicket(t), []);
});

test("'none' dependencies parse as empty", () => {
  assert.deepEqual(parseTicket(good.replace("- #3, #5", "- none")).dependencies, []);
});

test("missing heading is an error", () => {
  assert.throws(() => parseTicket(good.replace("## Out of scope", "## Notes")), TicketParseError);
});

test("bad test case type is an error", () => {
  assert.throws(() => parseTicket(good.replace("| 1 | check |", "| 1 | manual |")), /check or browser/);
});

test("lint flags vague results and empty out of scope", () => {
  const t = parseTicket(good.replace('Card shows "$13,947.21"', "Card works correctly").replace("Changing the interest formula.", ""));
  const p = lintTicket(t);
  assert.ok(p.some((x) => x.includes("vague")));
  assert.ok(p.includes("Out of scope is empty"));
});
