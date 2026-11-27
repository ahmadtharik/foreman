import { readFileSync } from "node:fs";
import { STATUSES, type ResultKind, type StageName, type Status } from "./types.ts";

/** What the runner does with a result. */
export type Transition =
  | { action: "move"; to: Status; countRound?: boolean }
  /** Leave the status, release the claim, try again later. No round counted. */
  | { action: "retry"; log: string };

export interface StageConfig {
  name: StageName;
  skill: string;
  /** Statuses that make an unclaimed ticket eligible for this stage. */
  triggers: Status[];
  max: number;
  on: Partial<Record<ResultKind, Transition>>;
}

export type Autonomy = "supervised" | "plan-approval" | "autonomous";

export interface Settings {
  targetRepo: string; // "owner/name"
  targetPath: string; // local clone
  board: { kind: "github"; projectNumber: number };
  autonomy: Autonomy;
  maxRounds: number;
  pollIntervalSec: number;
  claimTimeoutMin: number;
  maxDiffLines: number;
  agentTimeoutMin: number;
  allowedTools: { build: string[]; review: string[] };
  /** Command that starts the target app with seed data for testing. */
  testStartCommand: string;
  stages: StageConfig[];
}

/**
 * Default stage table. Adding a stage (e.g. security review) means adding an
 * entry here or in the settings file, not changing the runner.
 *
 * Two rules are enforced by the runner on top of this table:
 *  - "pass" without evidence for every test case is rejected and re-queued.
 *  - a "fail" that reaches maxRounds goes to Needs human instead.
 */
export const DEFAULT_STAGES: StageConfig[] = [
  {
    name: "build",
    skill: "foreman-build",
    triggers: ["Ready", "In progress"], // In progress + no claim = returned from QA
    max: 1,
    on: {
      built: { action: "move", to: "QA" },
      blocked: { action: "move", to: "Needs human" },
    },
  },
  {
    name: "review",
    skill: "foreman-review",
    triggers: ["QA"],
    max: 1,
    on: {
      pass: { action: "move", to: "Done" },
      fail: { action: "move", to: "In progress", countRound: true },
      environment: { action: "retry", log: "environment failure, not counted" },
      "test-case-wrong": { action: "move", to: "Needs human" },
    },
  },
];

export const DEFAULTS: Omit<Settings, "targetRepo" | "targetPath" | "board" | "testStartCommand"> = {
  autonomy: "plan-approval",
  maxRounds: 3,
  pollIntervalSec: 180,
  claimTimeoutMin: 60,
  maxDiffLines: 600,
  agentTimeoutMin: 45,
  allowedTools: {
    build: ["Read", "Edit", "Write", "Glob", "Grep", "Bash(git *)", "Bash(npm *)", "Bash(npx *)", "Bash(curl https://api.github.com/*)"],
    review: ["Read", "Glob", "Grep", "Bash(git *)", "Bash(npm *)", "Bash(npx playwright *)", "Bash(curl https://api.github.com/*)"],
  },
  stages: DEFAULT_STAGES,
};

export function loadSettings(path = "foreman.config.json"): Settings {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Settings>;
  const s = { ...DEFAULTS, ...raw } as Settings;
  validate(s);
  return s;
}

export function validate(s: Settings): void {
  const errs: string[] = [];
  if (!/^[\w.-]+\/[\w.-]+$/.test(s.targetRepo ?? "")) errs.push("targetRepo must be owner/name");
  if (!s.targetPath) errs.push("targetPath is required");
  if (!s.testStartCommand) errs.push("testStartCommand is required");
  if (!["supervised", "plan-approval", "autonomous"].includes(s.autonomy)) errs.push("bad autonomy");
  if (!(s.maxRounds >= 1)) errs.push("maxRounds must be >= 1");
  for (const st of s.stages) {
    for (const t of st.triggers) if (!STATUSES.includes(t)) errs.push(`stage ${st.name}: unknown trigger ${t}`);
    for (const tr of Object.values(st.on)) {
      if (tr?.action === "move" && !STATUSES.includes(tr.to)) errs.push(`stage ${st.name}: unknown status ${tr.to}`);
    }
  }
  if (errs.length) throw new Error(`Invalid settings:\n- ${errs.join("\n- ")}`);
}
