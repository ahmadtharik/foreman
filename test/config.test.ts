import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSettings } from "../src/config.ts";

const configPath = () => path.join(mkdtempSync(path.join(tmpdir(), "foreman-config-")), "foreman.config.json");

test("a missing config file says not found and how to fix it", () => {
  const p = configPath();
  assert.throws(() => loadSettings(p), {
    message: `${p} not found. Copy foreman.config.example.json and edit it.`,
  });
});

test("a config that is not JSON says so with the parser message", () => {
  const p = configPath();
  writeFileSync(p, "{not json");
  let parserMessage = "";
  try {
    JSON.parse("{not json");
  } catch (e) {
    parserMessage = (e as Error).message;
  }
  assert.throws(() => loadSettings(p), { message: `${p} is not valid JSON: ${parserMessage}` });
});

test("any other read error says cannot read with the error message", () => {
  const p = configPath();
  mkdirSync(p);
  assert.throws(() => loadSettings(p), { message: /^cannot read .*foreman\.config\.json: EISDIR: / });
});

test("settings rejected by validate keep the validate message", () => {
  const p = configPath();
  writeFileSync(p, JSON.stringify({ targetRepo: "bad" }));
  assert.throws(() => loadSettings(p), {
    message: "Invalid settings:\n- targetRepo must be owner/name\n- targetPath is required\n- testStartCommand is required",
  });
});
