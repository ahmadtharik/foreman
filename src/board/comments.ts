import { STATUSES, type Claim, type StageName, type Status } from "../types.ts";

/**
 * Machine-readable board comments. Each one is a human-readable sentence,
 * then a line `<!-- foreman {json} -->`, so `get` can rebuild the claim and
 * the round from comments alone.
 */
export type BoardEvent =
  | { kind: "move"; from: Status | null; to: Status; reason: string }
  | { kind: "claim"; by: string; stage: StageName; at: Date }
  | { kind: "release"; reason: string }
  | { kind: "round"; round: number }
  | { kind: "run-failed"; reason: string }
  | { kind: "passed"; sha: string };

const STAGES: readonly StageName[] = ["build", "review"];
const MARKER = /<!-- foreman (.*?) -->/gs;

function marker(data: Record<string, unknown>): string {
  // Escape < and > so text in a reason can never close the HTML comment early.
  const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  return `<!-- foreman ${json} -->`;
}

/** `from` is `null` when the ticket had no single status label before the move. */
export function formatMove(from: Status | null, to: Status, reason: string): string {
  const sentence = from === null ? `Moved to ${to}` : `Moved from ${from} to ${to}`;
  return `${sentence}: ${reason}\n${marker({ kind: "move", from, to, reason })}`;
}

export function formatClaim(claim: Claim): string {
  const at = claim.at.toISOString();
  return (
    `Claimed by ${claim.by} for ${claim.stage} at ${at}.\n` +
    marker({ kind: "claim", by: claim.by, stage: claim.stage, at })
  );
}

export function formatRelease(reason: string): string {
  return `Claim released: ${reason}\n${marker({ kind: "release", reason })}`;
}

export function formatRound(n: number): string {
  return `Round ${n}.\n${marker({ kind: "round", round: n })}`;
}

/** A run that produced no valid result. */
export function formatRunFailed(reason: string): string {
  return `Run failed: ${reason}\n${marker({ kind: "run-failed", reason })}`;
}

/** A passed review, with the commit it tested. */
export function formatPassed(sha: string): string {
  return `Review passed on ${sha}; waiting to merge.\n${marker({ kind: "passed", sha })}`;
}

const isString = (v: unknown): v is string => typeof v === "string";
const isStatus = (v: unknown): v is Status => isString(v) && (STATUSES as readonly string[]).includes(v);
const isStage = (v: unknown): v is StageName => isString(v) && (STAGES as readonly string[]).includes(v);

/** Read the Foreman event in a comment body, or `undefined` for anything else. Never throws. */
export function parseComment(body: string): BoardEvent | undefined {
  const matches = [...body.matchAll(MARKER)];
  const last = matches.at(-1);
  if (!last) return undefined;

  let data: unknown;
  try {
    data = JSON.parse(last[1]!);
  } catch {
    return undefined;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
  const d = data as Record<string, unknown>;

  switch (d.kind) {
    case "move":
      if ((d.from === null || isStatus(d.from)) && isStatus(d.to) && isString(d.reason)) {
        return { kind: "move", from: d.from, to: d.to, reason: d.reason };
      }
      return undefined;
    case "claim": {
      if (!isString(d.by) || !isStage(d.stage) || !isString(d.at)) return undefined;
      const at = new Date(d.at);
      if (Number.isNaN(at.getTime())) return undefined;
      return { kind: "claim", by: d.by, stage: d.stage, at };
    }
    case "release":
      return isString(d.reason) ? { kind: "release", reason: d.reason } : undefined;
    case "round":
      return Number.isInteger(d.round) && (d.round as number) >= 1
        ? { kind: "round", round: d.round as number }
        : undefined;
    case "run-failed":
      return isString(d.reason) && d.reason !== "" ? { kind: "run-failed", reason: d.reason } : undefined;
    case "passed":
      return isString(d.sha) && d.sha !== "" ? { kind: "passed", sha: d.sha } : undefined;
    default:
      return undefined;
  }
}

export interface BoardState {
  round: number;
  claim?: Claim;
  /** Run-failed events since the latest move. */
  failedRuns: number;
  /** Sha of the latest passed review since the latest move. */
  passedSha?: string;
  /** The status before the latest move, when that move went to Paused from a known status. */
  pausedFrom?: Status;
}

/** Rebuild board state from comment bodies, oldest first. */
export function boardState(bodies: string[]): BoardState {
  let round = 1;
  let claim: Claim | undefined;
  let failedRuns = 0;
  let passedSha: string | undefined;
  let pausedFrom: Status | undefined;
  for (const body of bodies) {
    const event = parseComment(body);
    if (event?.kind === "round") round = event.round;
    else if (event?.kind === "claim") claim = { by: event.by, stage: event.stage, at: event.at };
    else if (event?.kind === "release") claim = undefined;
    else if (event?.kind === "run-failed") failedRuns++;
    else if (event?.kind === "passed") passedSha = event.sha;
    else if (event?.kind === "move") {
      failedRuns = 0;
      passedSha = undefined;
      pausedFrom = event.to === "Paused" && event.from !== null ? event.from : undefined;
    }
  }
  const state: BoardState = { round, claim, failedRuns };
  if (passedSha !== undefined) state.passedSha = passedSha;
  if (pausedFrom !== undefined) state.pausedFrom = pausedFrom;
  return state;
}
