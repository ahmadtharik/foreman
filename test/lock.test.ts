import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { acquireLock } from "../src/runner/lock.ts";

const lockPath = () => path.join(mkdtempSync(path.join(tmpdir(), "foreman-lock-")), "foreman.lock");

test("acquire writes the pid and release deletes the file", () => {
  const p = lockPath();
  const lock = acquireLock(p);
  assert.equal(readFileSync(p, "utf8"), String(process.pid));
  lock.release();
  assert.equal(existsSync(p), false);
});

test("a lock held by a live pid is refused with the pid and the path", () => {
  const p = lockPath();
  writeFileSync(p, String(process.pid));
  assert.throws(() => acquireLock(p), {
    message: `Another runner is already running (pid ${process.pid}). Lock file: ${p}`,
  });
  assert.equal(readFileSync(p, "utf8"), String(process.pid));
});

test("a lock left by a dead pid is taken over", () => {
  const p = lockPath();
  const dead = spawnSync(process.execPath, ["-e", ""]).pid!;
  writeFileSync(p, String(dead));
  const lock = acquireLock(p);
  assert.equal(readFileSync(p, "utf8"), String(process.pid));
  lock.release();
  assert.equal(existsSync(p), false);
});

test("a lock file without a pid is taken over", () => {
  const p = lockPath();
  writeFileSync(p, "");
  acquireLock(p).release();
  assert.equal(existsSync(p), false);
});

test("a lock held by another live process is refused", async (t) => {
  const p = lockPath();
  const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"]);
  t.after(() => holder.kill());
  writeFileSync(p, String(holder.pid));
  assert.throws(() => acquireLock(p), { message: `Another runner is already running (pid ${holder.pid}). Lock file: ${p}` });
});
