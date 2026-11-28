import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULTS } from "../src/config.ts";

test("the runner exits 1 without FOREMAN_GITHUB_TOKEN", () => {
  const env = { ...process.env };
  delete env.FOREMAN_GITHUB_TOKEN;
  const r = spawnSync(process.execPath, ["src/scripts/runner.ts", "--dry-run"], { env, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FOREMAN_GITHUB_TOKEN is not set/);
});

// Starts the runner in a fresh temp folder so it never reads the real config.
function runIn(setup: (configPath: string) => void, args: string[], token: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "foreman-003-"));
  setup(path.join(dir, "foreman.config.json"));
  const r = spawnSync(process.execPath, [path.resolve("src/scripts/runner.ts"), ...args], {
    cwd: dir,
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, FOREMAN_GITHUB_TOKEN: token },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr.replace(/\r/g, "") };
}

const notFound = "foreman.config.json not found. Copy foreman.config.example.json and edit it.\n";

test("a missing config prints one line and exits 1, with and without --dry-run", () => {
  for (const args of [["--dry-run"], []]) {
    assert.deepEqual(runIn(() => {}, args, "bogus-token-003"), { status: 1, stdout: "", stderr: notFound });
  }
});

test("a config that is not JSON prints the parser message and exits 1", () => {
  let parserMessage = "";
  try {
    JSON.parse("{not json");
  } catch (e) {
    parserMessage = (e as Error).message;
  }
  assert.deepEqual(runIn((c) => writeFileSync(c, "{not json"), ["--dry-run"], "bogus-token-003"), {
    status: 1,
    stdout: "",
    stderr: `foreman.config.json is not valid JSON: ${parserMessage}\n`,
  });
});

test("a config rejected by validate prints the Invalid settings list and exits 1", () => {
  assert.deepEqual(runIn((c) => writeFileSync(c, JSON.stringify({ targetRepo: "bad" })), ["--dry-run"], "bogus-token-003"), {
    status: 1,
    stdout: "",
    stderr: "Invalid settings:\n- targetRepo must be owner/name\n- targetPath is required\n- testStartCommand is required\n",
  });
});

test("a config that cannot be read prints cannot read and exits 1", () => {
  assert.deepEqual(runIn((c) => mkdirSync(c), ["--dry-run"], "bogus-token-003"), {
    status: 1,
    stdout: "",
    stderr: "cannot read foreman.config.json: EISDIR: illegal operation on a directory, read\n",
  });
});

test("the token message comes before the config check", () => {
  assert.deepEqual(runIn(() => {}, ["--dry-run"], ""), { status: 1, stdout: "", stderr: "FOREMAN_GITHUB_TOKEN is not set\n" });
});

test("both stages may call the GitHub REST API with curl, listed last", () => {
  assert.equal(DEFAULTS.allowedTools.build.at(-1), "Bash(curl https://api.github.com/*)");
  assert.equal(DEFAULTS.allowedTools.review.at(-1), "Bash(curl https://api.github.com/*)");
});
