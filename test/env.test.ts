import { test } from "node:test";
import assert from "node:assert/strict";
import { agentEnv } from "../src/agent/env.ts";
import { DEFAULTS, DEFAULT_STAGES, validate } from "../src/config.ts";

test("agent env never carries an API key", () => {
  const env = agentEnv({ ANTHROPIC_API_KEY: "x", PATH: "/bin", GITHUB_TOKEN: "t", CLAUDE_CODE_SIMPLE: "1" });
  assert.deepEqual(env, { PATH: "/bin" });
});

test("a scoped token can be kept on purpose, the API key cannot be re-added by accident", () => {
  const env = agentEnv({ ANTHROPIC_API_KEY: "x", FOREMAN_REPO_TOKEN: "t" }, ["FOREMAN_REPO_TOKEN"]);
  assert.deepEqual(env, { FOREMAN_REPO_TOKEN: "t" });
});

test("default settings validate", () => {
  validate({ ...DEFAULTS, targetRepo: "a/b", targetPath: "../b", board: { kind: "github", projectNumber: 1 }, testStartCommand: "npm start" });
});

test("default stages cover every result their stage can produce", () => {
  assert.deepEqual(Object.keys(DEFAULT_STAGES[0]!.on).sort(), ["blocked", "built"]);
  assert.deepEqual(Object.keys(DEFAULT_STAGES[1]!.on).sort(), ["environment", "fail", "pass", "test-case-wrong"]);
});
