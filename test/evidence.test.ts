import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEvidence } from "../src/runner/evidence.ts";
import type { TestCase } from "../src/types.ts";

const cases = (...ids: string[]): TestCase[] => ids.map((id) => ({ id, type: "check", steps: "s", expected: "e" }));

function report(rows: string[]): string {
  return ["Result: PASS", "Round: 1", "", "| # | Result | Evidence |", "|---|--------|----------|", ...rows].join("\n");
}

test("1: names each test case without an evidenced pass row", () => {
  const comments = [report(["| 1 | pass | exit 0 |", "| 2 | pass |  |"])];
  assert.deepEqual(checkEvidence(cases("1", "2", "3"), comments), [
    "no evidence for test case 2",
    "no evidence for test case 3",
  ]);
});

test("2: no PASS report, then a full report", () => {
  assert.deepEqual(checkEvidence(cases("1"), ["Result: FAIL\n| 1 | fail | broke |", "just a note"]), ["no PASS report"]);
  assert.deepEqual(checkEvidence(cases("1"), []), ["no PASS report"]);
  const full = report(["| 1 | pass | exit 0 |", "| 2 | pass | `npm test` 10/10 |", "| 3 | pass | shot.png |"]);
  assert.deepEqual(checkEvidence(cases("1", "2", "3"), [full]), []);
});

test("2b: placeholder evidence and non-pass rows do not count; the latest report wins", () => {
  const rows = report(["| 1 | pass | - |", "| 2 | pass | None |", "| 3 | pass | N/A |", "| 4 | fail | exit 1 |"]);
  assert.deepEqual(checkEvidence(cases("1", "2", "3", "4"), [rows]), [
    "no evidence for test case 1",
    "no evidence for test case 2",
    "no evidence for test case 3",
    "no evidence for test case 4",
  ]);
  const old = report(["| 1 | pass | exit 0 |"]);
  const latest = report(["| 1 | pass |  |"]);
  assert.deepEqual(checkEvidence(cases("1"), [old, latest, "a later note"]), ["no evidence for test case 1"]);
});

test("2c: a line that only mentions Result: PASS mid-sentence is not a report", () => {
  assert.deepEqual(checkEvidence(cases("1"), ["I expect Result: PASS soon\n| 1 | pass | exit 0 |"]), ["no PASS report"]);
});
