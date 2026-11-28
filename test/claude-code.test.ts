import { test } from "node:test";
import assert from "node:assert/strict";
import { toOutcome } from "../src/agent/claude-code.ts";

const AUTH = "Failed to authenticate: this login reached its time limit and cannot be renewed.";

test("a crash with empty stderr reports the JSON result as the reason", () => {
  const stdout = JSON.stringify({ type: "result", is_error: true, result: AUTH });
  const out = toOutcome(1, stdout, "");
  assert.equal(out.kind, "crashed");
  assert.equal(out.kind === "crashed" && out.error, `exit 1: ${AUTH}`);
});

test("a crash with stderr still reports stderr", () => {
  const out = toOutcome(1, JSON.stringify({ result: "ignored" }), "boom\n");
  assert.equal(out.kind === "crashed" && out.error, "exit 1: boom");
});

test("a crash with non-JSON stdout and empty stderr reports raw stdout", () => {
  const out = toOutcome(1, "not json\n", "");
  assert.equal(out.kind === "crashed" && out.error, "exit 1: not json");
});
