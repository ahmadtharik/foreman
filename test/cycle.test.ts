import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentRunOutcome } from "../src/agent/types.ts";
import { DEFAULTS, type Settings } from "../src/config.ts";
import { runCycle } from "../src/runner/cycle.ts";
import type { ResultKind, StageName, Ticket } from "../src/types.ts";
import { FakeAgent, FakeBoard, FakeWorktrees, fakeTicket } from "./fakes.ts";

const NOW = new Date("2026-11-24T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const settings: Settings = {
  ...DEFAULTS,
  targetRepo: "owner/target",
  targetPath: "/target",
  board: { kind: "github", projectNumber: 1 },
  testStartCommand: "npm start",
};

function result(stage: StageName, ticket: number, kind: ResultKind, reason?: string): AgentRunOutcome {
  const r: AgentRunOutcome = { kind: "result", result: { stage, ticket, result: kind, round: 1 }, transcript: "" };
  if (reason) r.result.reason = reason;
  return r;
}

function setup(tickets: Ticket[], opts: { build?: FakeAgent; review?: FakeAgent; secrets?: string[]; settings?: Settings } = {}) {
  const cfg = opts.settings ?? settings;
  const board = new FakeBoard(tickets, { claimTimeoutMin: settings.claimTimeoutMin, now: () => NOW });
  const build = opts.build ?? new FakeAgent();
  const review = opts.review ?? new FakeAgent();
  const worktrees = new FakeWorktrees();
  const logs: string[] = [];
  const cycle = (extra: { dryRun?: boolean; runnerId?: string } = {}) =>
    runCycle({
      board,
      agents: { build, review },
      worktrees,
      settings: cfg,
      runnerId: extra.runnerId ?? "runner-1",
      now: () => NOW,
      log: (n, action, reason) => logs.push(`${n === null ? "-" : `#${n}`} ${action}: ${reason}`),
      dryRun: extra.dryRun,
      secrets: opts.secrets,
    });
  return { board, build, review, worktrees, logs, cycle };
}

const reviewOnly: Settings = { ...settings, stages: settings.stages.filter((s) => s.name === "review") };

const status = (board: FakeBoard, n: number) => board.tickets.get(n)!.status;
const lastMoveReason = (board: FakeBoard, n: number) => board.callsFor(n, "move").at(-1)?.args[1];

test("1: promotes a Backlog ticket only when every dependency is Done", async () => {
  const { board, cycle } = setup([
    fakeTicket({ number: 1, status: "Done" }),
    fakeTicket({ number: 2, status: "Backlog", deps: [1] }),
    fakeTicket({ number: 3, status: "Backlog", deps: [1, 2] }),
  ], { settings: reviewOnly }); // no build stage, so #2 is not also picked in this cycle
  await cycle();
  assert.equal(status(board, 2), "Ready");
  assert.deepEqual(board.callsFor(2, "move")[0]!.args, ["Ready", "all dependencies Done"]);
  assert.equal(status(board, 3), "Backlog");
  assert.equal(board.callsFor(3, "move").length, 0);
});

test("1b: a dependency outside the open list is read with get; a failed read counts as not Done", async () => {
  const { board, cycle } = setup([
    fakeTicket({ number: 4, status: "Backlog", deps: [1] }),
    fakeTicket({ number: 5, status: "Backlog", deps: [99] }),
  ]);
  board.closed.set(1, fakeTicket({ number: 1, status: "Done" }));
  await cycle({ dryRun: true });
  assert.equal(board.callsFor(1, "get").length, 1);
  assert.equal(board.callsFor(99, "get").length, 1);
});

test("2: releases a stale claim and reviews that ticket; a younger claim is left alone", async () => {
  const review = new FakeAgent(result("review", 4, "pass"));
  const { board, cycle } = setup(
    [
      fakeTicket({ number: 4, status: "QA", claim: { by: "r0", stage: "review", at: minutesAgo(61) } }),
      fakeTicket({ number: 5, status: "QA", claim: { by: "r0", stage: "review", at: minutesAgo(10) } }),
    ],
    { review },
  );
  await cycle();
  const releases = board.callsFor(4, "release");
  assert.match(releases[0]!.args[0] as string, /^stale claim by r0 for review since .+, older than 60 min$/);
  assert.deepEqual(review.runs.map((r) => r.ticket.number), [4]);
  assert.equal(board.callsFor(5, "release").length, 0);
  assert.equal(board.callsFor(5).length, 0);
});

test("3: picks only eligible tickets, one per stage, lowest number first", async () => {
  const build = new FakeAgent(result("build", 7, "built"));
  const review = new FakeAgent(result("review", 11, "pass"));
  const { cycle } = setup(
    [
      fakeTicket({ number: 9, status: "Ready" }),
      fakeTicket({ number: 7, status: "Ready" }),
      fakeTicket({ number: 6, status: "Ready", deps: [1] }),
      fakeTicket({ number: 1, status: "In progress", claim: { by: "x", stage: "build", at: minutesAgo(5) } }),
      fakeTicket({ number: 8, status: "Ready", rawBody: "not a ticket" }),
      fakeTicket({ number: 10, status: "QA", passedSha: "abc" }),
      fakeTicket({ number: 11, status: "QA" }),
    ],
    { build, review },
  );
  await cycle();
  assert.deepEqual(build.runs.map((r) => r.ticket.number), [7]);
  assert.deepEqual(review.runs.map((r) => r.ticket.number), [11]);
  assert.equal(build.runs[0]!.skill, "foreman-build");
  assert.equal(review.runs[0]!.skill, "foreman-review");
});

for (const [stage, from, kind, to] of [
  ["build", "Ready", "built", "QA"],
  ["build", "Ready", "blocked", "Needs human"],
  ["review", "QA", "pass", "Done"],
  ["review", "QA", "test-case-wrong", "Needs human"],
  ["review", "QA", "environment", "QA"],
] as const) {
  test(`4: ${stage} ${kind} ends in ${to} with no round added`, async () => {
    const agent = new FakeAgent(result(stage, 20, kind, kind === "built" || kind === "pass" ? undefined : "why"));
    const { board, worktrees, cycle } = setup([fakeTicket({ number: 20, status: from })], { [stage]: agent });
    await cycle();
    assert.equal(status(board, 20), to);
    assert.equal(board.callsFor(20, "setRound").length, 0);
    assert.equal(board.tickets.get(20)!.claim, undefined);
    assert.deepEqual(worktrees.calls.map((c) => c.method), ["prepare", "remove"]);
    assert.equal(agent.runs[0]!.round, 1);
  });
}

test("5: review fail adds a round; in round maxRounds it goes to Needs human", async () => {
  const review = new FakeAgent(result("review", 30, "fail", "broken"), result("review", 31, "fail", "broken"));
  const { board, cycle } = setup(
    [fakeTicket({ number: 30, status: "QA", round: 1 }), fakeTicket({ number: 31, status: "QA", round: 3 })],
    { review },
  );
  await cycle();
  assert.deepEqual(board.callsFor(30, "setRound")[0]!.args, [2]);
  assert.equal(status(board, 30), "In progress");
  assert.equal(lastMoveReason(board, 30), "fail: broken");

  await cycle(); // #30 is now In progress, so review picks #31
  assert.equal(board.callsFor(31, "setRound").length, 0);
  assert.equal(status(board, 31), "Needs human");
  assert.equal(lastMoveReason(board, 31), "round cap 3 reached");
});

test("6: a usage limit pauses the ticket; the next cycle resumes it to where it came from", async () => {
  const review = new FakeAgent({ kind: "usage-limit", transcript: "" });
  const { board, cycle } = setup([fakeTicket({ number: 12, status: "QA" })], { review });
  await cycle();
  assert.equal(status(board, 12), "Paused");
  assert.equal(board.callsFor(12, "setRound").length, 0);

  await cycle();
  assert.equal(status(board, 12), "QA");
  assert.deepEqual(board.callsFor(12, "move")[1]!.args, ["QA", "resumed after usage limit"]);
  assert.equal(board.callsFor(12, "setRound").length, 0);
});

test("7: crashes record failed runs; the third moves to Needs human; a wrong-number result moves nothing", async () => {
  const crash: AgentRunOutcome = { kind: "crashed", error: "exit 1", transcript: "" };
  const build = new FakeAgent(crash, crash, crash, result("build", 99, "built"));
  const { board, cycle } = setup([fakeTicket({ number: 13, status: "Ready" })], { build });

  await cycle();
  assert.equal(status(board, 13), "In progress");
  assert.equal(board.tickets.get(13)!.failedRuns, 1);
  await cycle();
  assert.equal(status(board, 13), "In progress");
  assert.equal(board.tickets.get(13)!.failedRuns, 2);
  await cycle();
  assert.equal(status(board, 13), "Needs human");
  assert.equal(lastMoveReason(board, 13), "3 runs in a row without a valid result");

  board.tickets.set(14, fakeTicket({ number: 14, status: "In progress" }));
  await cycle();
  assert.equal(board.callsFor(14, "recordRunFailed").length, 1);
  assert.equal(board.callsFor(14, "move").length, 0);
  assert.equal(status(board, 14), "In progress");
});

test("7b: a thrown error from the agent or worktree counts as a failed run", async () => {
  const build = new FakeAgent(() => {
    throw new Error("spawn failed");
  });
  const { board, cycle } = setup([fakeTicket({ number: 15, status: "In progress" })], { build });
  await cycle();
  assert.equal(board.callsFor(15, "recordRunFailed").length, 1);
  assert.equal(board.tickets.get(15)!.claim, undefined);
});

test("8: a claim left by a killed runner is released once stale and picked again in the same cycle", async () => {
  const review = new FakeAgent(result("review", 14, "pass"));
  const { board, cycle } = setup(
    [fakeTicket({ number: 14, status: "QA", claim: { by: "old-runner", stage: "review", at: minutesAgo(61) } })],
    { review },
  );
  await cycle({ runnerId: "new-runner" });
  const methods = board.callsFor(14).filter((c) => c.method !== "get").map((c) => c.method);
  assert.deepEqual(methods, ["release", "claim", "move", "release"]);
  assert.match(board.callsFor(14, "release")[0]!.args[0] as string, /^stale claim by old-runner/);
  assert.deepEqual(board.callsFor(14, "claim")[0]!.args, ["review", "new-runner"]);
  assert.equal(review.runs.length, 1);
});

test("9: dry run writes nothing and logs one would line per action", async () => {
  const build = new FakeAgent();
  const review = new FakeAgent();
  const { board, worktrees, logs, cycle } = setup(
    [
      fakeTicket({ number: 1, status: "Done" }),
      fakeTicket({ number: 2, status: "Paused", pausedFrom: "In progress", claim: undefined }),
      fakeTicket({ number: 3, status: "Backlog", deps: [1] }),
      fakeTicket({ number: 4, status: "Done", claim: { by: "x", stage: "build", at: minutesAgo(90) } }),
      fakeTicket({ number: 5, status: "Ready" }),
    ],
    { build, review },
  );
  await cycle({ dryRun: true });
  assert.equal(board.writes.length, 0);
  assert.equal(worktrees.calls.length, 0);
  assert.equal(build.runs.length + review.runs.length, 0);
  for (const w of ["would resume", "would promote", "would release", "would start build"]) {
    assert.equal(logs.filter((l) => l.includes(w)).length, 1, `${w} in ${logs.join("\n")}`);
  }
  assert.ok(logs.every((l) => l.includes("would ")));
});

test("10: secrets never reach the board or the log", async () => {
  const build = new FakeAgent(result("build", 40, "blocked", "saw tok-123"));
  const { board, logs, cycle } = setup([fakeTicket({ number: 40, status: "Ready" })], {
    build,
    secrets: ["tok-123"],
  });
  await cycle();
  assert.ok(board.texts.every((t) => !t.includes("tok-123")));
  assert.ok(logs.every((l) => !l.includes("tok-123")));
  assert.match(lastMoveReason(board, 40) as string, /\*\*\*/);
});
