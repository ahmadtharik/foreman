import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DEFAULTS } from "../src/config.ts";

test("the runner exits 1 without FOREMAN_GITHUB_TOKEN", () => {
  const env = { ...process.env };
  delete env.FOREMAN_GITHUB_TOKEN;
  const r = spawnSync(process.execPath, ["src/scripts/runner.ts", "--dry-run"], { env, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FOREMAN_GITHUB_TOKEN is not set/);
});

test("both stages may call the GitHub REST API with curl, listed last", () => {
  assert.equal(DEFAULTS.allowedTools.build.at(-1), "Bash(curl https://api.github.com/*)");
  assert.equal(DEFAULTS.allowedTools.review.at(-1), "Bash(curl https://api.github.com/*)");
});
