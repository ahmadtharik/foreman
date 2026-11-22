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
  | { kind: "round"; round: number };

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
    default:
      return undefined;
  }
}

/** Rebuild round and claim from comment bodies, oldest first. */
export function boardState(bodies: string[]): { round: number; claim?: Claim } {
  let round = 1;
  let claim: Claim | undefined;
  for (const body of bodies) {
    const event = parseComment(body);
    if (event?.kind === "round") round = event.round;
    else if (event?.kind === "claim") claim = { by: event.by, stage: event.stage, at: event.at };
    else if (event?.kind === "release") claim = undefined;
  }
  return { round, claim };
}
