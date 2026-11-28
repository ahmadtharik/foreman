// The runner: repeats runCycle every pollIntervalSec against the real board.
// Usage: npm run runner            (loops until stopped)
//        npm run runner -- --dry-run  (one cycle, prints what it would do, changes nothing)
import { hostname } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ClaudeCodeAgent } from "../agent/claude-code.ts";
import { GitHubBoard } from "../board/github.ts";
import { loadSettings, type Settings } from "../config.ts";
import { GitHubPulls } from "../github/pulls.ts";
import { runCycle, type CycleDeps, type CycleLog } from "../runner/cycle.ts";
import { acquireLock, type Lock } from "../runner/lock.ts";
import { createLog } from "../runner/log.ts";
import { GitWorktrees } from "../runner/worktree.ts";

const token = process.env.FOREMAN_GITHUB_TOKEN;
if (!token) {
  console.error("FOREMAN_GITHUB_TOKEN is not set");
  process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");
const redact = (s: string) => s.split(token).join("***");

let settings: Settings;
try {
  settings = loadSettings();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
const writeLog = createLog({ dir: path.resolve("logs"), secrets: [token] });
let logged = 0;
const log: CycleLog = (ticket, action, reason) => {
  logged++;
  writeLog(ticket, action, reason);
};

// Agents keep only the repo token; agentEnv strips any API key.
const agent = (tools: string[]) =>
  new ClaudeCodeAgent({ allowedTools: tools, keepEnv: ["FOREMAN_GITHUB_TOKEN"], timeoutMs: settings.agentTimeoutMin * 60_000 });

const deps: CycleDeps = {
  board: new GitHubBoard({ repo: settings.targetRepo, token, claimTimeoutMin: settings.claimTimeoutMin }),
  agents: { build: agent(settings.allowedTools.build), review: agent(settings.allowedTools.review) },
  worktrees: new GitWorktrees({ repoPath: path.resolve(settings.targetPath), root: path.resolve("runs/worktrees") }),
  pulls: new GitHubPulls({ repo: settings.targetRepo, token }),
  settings,
  runnerId: `${hostname()}-${process.pid}`,
  now: () => new Date(),
  log,
  dryRun,
  secrets: [token],
};

if (dryRun) {
  try {
    await runCycle(deps);
  } catch (e) {
    console.error(redact(`dry run failed: ${(e as Error).message}`));
    process.exit(1);
  }
  if (logged === 0) log(null, "dry run", "nothing to do");
  process.exit(0);
}

let lock: Lock;
try {
  lock = acquireLock("foreman.lock");
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
process.on("exit", () => lock.release());
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log(null, "stop", `received ${signal}`);
    process.exit(0);
  });
}

log(null, "start", `runner ${deps.runnerId} on ${settings.targetRepo}, every ${settings.pollIntervalSec}s`);
for (;;) {
  try {
    await runCycle(deps);
  } catch (e) {
    log(null, "cycle failed", (e as Error).message);
  }
  await sleep(settings.pollIntervalSec * 1000);
}
