import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLog } from "../src/runner/log.ts";

test("lines go to stdout and the day's file, with secrets replaced", (t) => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "foreman-log-")), "logs");
  const out = t.mock.method(console, "log", () => {});
  const log = createLog({ dir, secrets: ["tok-123", ""], now: () => new Date("2026-11-22T10:00:00Z") });
  log(7, "move", "saw tok-123 and tok-123");
  log(null, "cycle", "done");
  const lines = ["2026-11-22T10:00:00.000Z #7 move: saw *** and ***", "2026-11-22T10:00:00.000Z - cycle: done"];
  assert.deepEqual(out.mock.calls.map((c) => c.arguments[0]), lines);
  assert.equal(readFileSync(path.join(dir, "runner-2026-11-22.log"), "utf8"), lines.join("\n") + "\n");
});
