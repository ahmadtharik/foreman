import { test } from "node:test";
import assert from "node:assert/strict";
import { parseResult, ResultParseError } from "../src/result.ts";

const block = (lines: string) => `Did the work.\n\nFOREMAN-RESULT\n${lines}\n`;

test("parses a built result", () => {
  const r = parseResult(block("stage: build\nticket: #12\nresult: built\nround: 1\npull_request: https://github.com/o/r/pull/3\nreason:"));
  assert.deepEqual(r, { stage: "build", ticket: 12, result: "built", round: 1, pullRequest: "https://github.com/o/r/pull/3", reason: undefined });
});

test("uses the last block when there are several", () => {
  const out = block("stage: build\nticket: #1\nresult: blocked\nround: 1\nreason: x") + block("stage: build\nticket: #1\nresult: built\nround: 1");
  assert.equal(parseResult(out).result, "built");
});

test("accepts an indented block inside a code fence", () => {
  const out = "```\n    FOREMAN-RESULT\n    stage: review\n    ticket: #4\n    result: pass\n    round: 2\n```";
  assert.equal(parseResult(out).round, 2);
});

test("rejects a missing block", () => {
  assert.throws(() => parseResult("all done"), ResultParseError);
});

test("rejects a result from the wrong stage", () => {
  assert.throws(() => parseResult(block("stage: build\nticket: #1\nresult: pass\nround: 1")), /not allowed/);
});

test("requires a reason for fail", () => {
  assert.throws(() => parseResult(block("stage: review\nticket: #1\nresult: fail\nround: 1\nreason:")), /requires a reason/);
});

test("treats template placeholders as empty", () => {
  const r = parseResult(block("stage: build\nticket: #1\nresult: built\nround: 1\npull_request: <link, if any>"));
  assert.equal(r.pullRequest, undefined);
});
