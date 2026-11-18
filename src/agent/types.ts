import type { AgentResult, StageName, Ticket } from "../types.ts";

export interface AgentRunInput {
  stage: StageName;
  skill: string;
  ticket: Ticket;
  workdir: string; // the ticket's own git worktree
  round: number;
}

export type AgentRunOutcome =
  | { kind: "result"; result: AgentResult; transcript: string }
  /** Plan usage limit hit: ticket goes to Paused, no round is counted. */
  | { kind: "usage-limit"; transcript: string }
  /** Agent finished but wrote no valid result block. */
  | { kind: "no-result"; error: string; transcript: string }
  | { kind: "crashed"; error: string; transcript: string };

/** "Run this stage on this ticket in this working copy and return a result." */
export interface AgentAdapter {
  run(input: AgentRunInput): Promise<AgentRunOutcome>;
}
