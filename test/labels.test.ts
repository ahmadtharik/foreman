import { test } from "node:test";
import assert from "node:assert/strict";
import { statusFromLabels } from "../src/board/labels.ts";

test("reads the single status label", () => {
  assert.equal(statusFromLabels(["bug", "status: qa"]), "QA");
});

test("no status label or two status labels is unknown", () => {
  assert.equal(statusFromLabels(["bug"]), undefined);
  assert.equal(statusFromLabels(["status: qa", "status: done"]), undefined);
});
