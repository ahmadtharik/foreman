import type { Claim, StageName, Status, Ticket } from "../types.ts";

/**
 * The ticket store. GitHub Issues + Projects is the first implementation;
 * Jira or Trello can be added behind the same interface.
 *
 * State lives on the tickets (status, round, claim), so the runner can crash
 * and restart without losing track.
 */
export interface BoardAdapter {
  create(input: { title: string; body: string; status: Status }): Promise<Ticket>;
  get(number: number): Promise<Ticket>;
  list(filter?: { statuses?: Status[] }): Promise<Ticket[]>;

  /** Atomically-enough claim: fails if a fresh claim already exists. */
  claim(number: number, stage: StageName, by: string): Promise<Claim>;
  release(number: number, reason: string): Promise<void>;

  /** Only the runner calls this. */
  move(number: number, to: Status, reason: string): Promise<void>;
  setRound(number: number, round: number): Promise<void>;
  comment(number: number, body: string): Promise<void>;
  /** Record a run that produced no valid result (one comment). */
  recordRunFailed(number: number, reason: string): Promise<void>;
  /** Record a passed review and the commit it tested (one comment). */
  recordPassed(number: number, sha: string): Promise<void>;
  /** Every comment body, oldest first. */
  comments(number: number): Promise<string[]>;
}
