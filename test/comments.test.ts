import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boardState,
  formatClaim,
  formatMove,
  formatPassed,
  formatRelease,
  formatRound,
  formatRunFailed,
  parseComment,
} from "../src/board/comments.ts";
import type { Claim } from "../src/types.ts";

const claimBy = (by: string, iso = "2026-11-18T10:00:00.000Z"): Claim => ({ by, stage: "build", at: new Date(iso) });

test("move round-trips", () => {
  assert.deepEqual(parseComment(formatMove("Ready", "In progress", "claimed by runner-1")), {
    kind: "move",
    from: "Ready",
    to: "In progress",
    reason: "claimed by runner-1",
  });
});

test("claim round-trips with at as a Date", () => {
  const event = parseComment(formatClaim({ by: "runner-1", stage: "review", at: new Date("2026-11-18T10:00:00.000Z") }));
  assert.equal(event?.kind, "claim");
  if (event?.kind !== "claim") return;
  assert.equal(event.by, "runner-1");
  assert.equal(event.stage, "review");
  assert.ok(event.at instanceof Date);
  assert.equal(event.at.toISOString(), "2026-11-18T10:00:00.000Z");
});

test("release round-trips", () => {
  assert.deepEqual(parseComment(formatRelease("agent finished")), { kind: "release", reason: "agent finished" });
});

test("round round-trips", () => {
  assert.deepEqual(parseComment(formatRound(3)), { kind: "round", round: 3 });
});

test("a reason containing --> and quotes still round-trips", () => {
  const reason = 'odd "text" --> <!-- foreman {} --> end';
  assert.deepEqual(parseComment(formatRelease(reason)), { kind: "release", reason });
});

test("parses the example marker from the ticket", () => {
  const body =
    'Claimed.\n<!-- foreman {"kind":"claim","by":"runner-1","stage":"build","at":"2026-11-18T10:00:00.000Z"} -->';
  assert.deepEqual(parseComment(body), { kind: "claim", ...claimBy("runner-1") });
});

test("no Foreman comments gives round 1 and no claim", () => {
  assert.deepEqual(boardState(["plain text"]), { round: 1, claim: undefined, failedRuns: 0 });
  assert.deepEqual(boardState([]), { round: 1, claim: undefined, failedRuns: 0 });
});

test("latest round wins", () => {
  assert.equal(boardState([formatRound(2), "hello", formatRound(3)]).round, 3);
});

test("claim then release gives no claim", () => {
  assert.equal(boardState([formatClaim(claimBy("A")), formatRelease("done")]).claim, undefined);
});

test("latest claim wins", () => {
  const state = boardState([formatClaim(claimBy("A")), formatClaim(claimBy("B", "2026-11-18T11:00:00.000Z"))]);
  assert.equal(state.claim?.by, "B");
  assert.equal(state.claim?.at.toISOString(), "2026-11-18T11:00:00.000Z");
});

test("release then a new claim keeps the new claim", () => {
  const state = boardState([formatClaim(claimBy("A")), formatRelease("done"), formatClaim(claimBy("B"))]);
  assert.equal(state.claim?.by, "B");
});

test("plain and malformed comments return undefined without throwing", () => {
  const bad = [
    "plain text",
    "",
    "<!-- foreman {not json -->",
    "<!-- foreman [1,2] -->",
    "<!-- foreman null -->",
    '<!-- foreman {"kind":"teleport"} -->',
    '<!-- foreman {"kind":"claim","by":"runner-1","stage":"deploy","at":"2026-11-18T10:00:00.000Z"} -->',
    '<!-- foreman {"kind":"claim","by":"runner-1","stage":"build","at":"not a date"} -->',
    '<!-- foreman {"kind":"claim","stage":"build","at":"2026-11-18T10:00:00.000Z"} -->',
    '<!-- foreman {"kind":"move","from":"Ready","to":"Shipped","reason":"x"} -->',
    '<!-- foreman {"kind":"round","round":"2"} -->',
    '<!-- foreman {"kind":"round","round":0} -->',
    '<!-- foreman {"kind":"release"} -->',
  ];
  for (const body of bad) {
    assert.doesNotThrow(() => parseComment(body));
    assert.equal(parseComment(body), undefined, body);
  }
});

test("run-failed and passed round-trip", () => {
  assert.deepEqual(parseComment(formatRunFailed("no block")), { kind: "run-failed", reason: "no block" });
  assert.deepEqual(parseComment(formatPassed("abc123")), { kind: "passed", sha: "abc123" });
  assert.match(formatPassed("abc123"), /^Review passed on abc123; waiting to merge\./);
  assert.match(formatRunFailed("no block"), /^Run failed: no block/);
});

test("a passed marker with an empty or non-string sha, or a run-failed with an empty reason, is ignored", () => {
  assert.equal(parseComment(formatPassed("")), undefined);
  assert.equal(parseComment('<!-- foreman {"kind":"passed","sha":5} -->'), undefined);
  assert.equal(parseComment(formatRunFailed("")), undefined);
  assert.equal(parseComment('<!-- foreman {"kind":"run-failed"} -->'), undefined);
});

test("failedRuns counts only run-failed events after the latest move", () => {
  const bodies = [formatRunFailed("a"), formatMove("QA", "QA", "x"), formatRunFailed("b"), formatRunFailed("c")];
  assert.equal(boardState(bodies).failedRuns, 2);
  assert.equal(boardState([formatRunFailed("a")]).failedRuns, 1);
  assert.equal(boardState([]).failedRuns, 0);
});

test("passedSha is the latest passed event, cleared by a later move", () => {
  assert.equal(boardState([formatPassed("abc")]).passedSha, "abc");
  assert.equal(boardState([formatPassed("abc"), formatPassed("def")]).passedSha, "def");
  assert.equal(boardState([formatPassed("abc"), formatMove("QA", "Done", "merged")]).passedSha, undefined);
  assert.equal(boardState([formatMove("Ready", "QA", "x"), formatPassed("abc")]).passedSha, "abc");
});

test("pausedFrom is set while the latest move went to Paused from a known status", () => {
  assert.equal(boardState([formatMove("QA", "Paused", "limit")]).pausedFrom, "QA");
  assert.equal(
    boardState([formatMove("QA", "Paused", "limit"), formatMove("Paused", "QA", "resumed")]).pausedFrom,
    undefined,
  );
  assert.equal(boardState([formatMove(null, "Paused", "limit")]).pausedFrom, undefined);
  assert.equal(boardState([formatMove("Ready", "QA", "x")]).pausedFrom, undefined);
});
