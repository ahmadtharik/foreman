// In-memory fakes for the board, the agents and the worktrees. No network, git or Claude Code.
import type { AgentAdapter, AgentRunInput, AgentRunOutcome } from "../src/agent/types.ts";
import type { BoardAdapter } from "../src/board/types.ts";
import type { PreparedWorktree, Worktrees } from "../src/runner/worktree.ts";
import { parseTicket } from "../src/ticket.ts";
import type { Claim, StageName, Status, Ticket } from "../src/types.ts";

/** A ticket body that matches the template, with the given dependencies. */
export function ticketBody(dependencies: number[] = []): string {
  return [
    "## Summary",
    "Do a thing.",
    "## Context",
    "None.",
    "## Definition of done",
    "- [ ] It works.",
    "## Test cases",
    "| # | Type | Steps | Expected result |",
    "|---|------|-------|-----------------|",
    "| 1 | check | Run it | It exits 0 |",
    "## Dependencies",
    dependencies.length ? dependencies.map((d) => `- #${d}`).join("\n") : "None",
    "## Files likely touched",
    "- src/x.ts",
    "## Out of scope",
    "Everything else.",
  ].join("\n");
}

export interface FakeTicketInput {
  number: number;
  status: Status;
  deps?: number[];
  rawBody?: string;
  round?: number;
  claim?: Claim;
  failedRuns?: number;
  passedSha?: string;
  pausedFrom?: Status;
}

export function fakeTicket(input: FakeTicketInput): Ticket {
  const rawBody = input.rawBody ?? ticketBody(input.deps);
  const t: Ticket = {
    number: input.number,
    title: `Ticket ${input.number}`,
    status: input.status,
    body: null,
    rawBody,
    round: input.round ?? 1,
    failedRuns: input.failedRuns ?? 0,
  };
  try {
    t.body = parseTicket(rawBody);
  } catch (e) {
    t.parseError = (e as Error).message;
  }
  if (input.claim) t.claim = input.claim;
  if (input.passedSha !== undefined) t.passedSha = input.passedSha;
  if (input.pausedFrom !== undefined) t.pausedFrom = input.pausedFrom;
  return t;
}

export interface BoardCall {
  method: string;
  number: number;
  args: unknown[];
}

const WRITES = new Set(["create", "claim", "release", "move", "setRound", "comment", "recordRunFailed", "recordPassed"]);

/** In-memory board with the same state rules as the GitHub board. */
export class FakeBoard implements BoardAdapter {
  readonly tickets = new Map<number, Ticket>();
  /** Tickets not in the open list (e.g. closed), readable with `get`. */
  readonly closed = new Map<number, Ticket>();
  readonly calls: BoardCall[] = [];
  /** Every text written to the board. */
  readonly texts: string[] = [];
  readonly claimTimeoutMin: number;
  readonly now: () => Date;

  constructor(tickets: Ticket[], opts: { claimTimeoutMin?: number; now?: () => Date } = {}) {
    for (const t of tickets) this.tickets.set(t.number, t);
    this.claimTimeoutMin = opts.claimTimeoutMin ?? 60;
    this.now = opts.now ?? (() => new Date());
  }

  get writes(): BoardCall[] {
    return this.calls.filter((c) => WRITES.has(c.method));
  }

  callsFor(number: number, method?: string): BoardCall[] {
    return this.calls.filter((c) => c.number === number && (!method || c.method === method));
  }

  #t(number: number): Ticket {
    const t = this.tickets.get(number);
    if (!t) throw new Error(`#${number} not found`);
    return t;
  }

  #record(method: string, number: number, ...args: unknown[]): void {
    this.calls.push({ method, number, args });
    for (const a of args) if (typeof a === "string") this.texts.push(a);
  }

  async create(input: { title: string; body: string; status: Status }): Promise<Ticket> {
    const number = Math.max(0, ...this.tickets.keys()) + 1;
    this.#record("create", number, input.title, input.body, input.status);
    const t = fakeTicket({ number, status: input.status, rawBody: input.body });
    this.tickets.set(number, t);
    return structuredClone(t);
  }

  async get(number: number): Promise<Ticket> {
    this.#record("get", number);
    const t = this.tickets.get(number) ?? this.closed.get(number);
    if (!t) throw new Error(`#${number} not found`);
    return structuredClone(t);
  }

  async list(filter?: { statuses?: Status[] }): Promise<Ticket[]> {
    this.calls.push({ method: "list", number: 0, args: [filter] });
    return [...this.tickets.values()]
      .filter((t) => !filter?.statuses || filter.statuses.includes(t.status))
      .map((t) => structuredClone(t));
  }

  async claim(number: number, stage: StageName, by: string): Promise<Claim> {
    this.#record("claim", number, stage, by);
    const t = this.#t(number);
    const now = this.now();
    if (t.claim && now.getTime() - t.claim.at.getTime() < this.claimTimeoutMin * 60_000) {
      throw new Error(`#${number} is already claimed by ${t.claim.by}`);
    }
    t.claim = { by, stage, at: now };
    return structuredClone(t.claim);
  }

  async release(number: number, reason: string): Promise<void> {
    this.#record("release", number, reason);
    delete this.#t(number).claim;
  }

  async move(number: number, to: Status, reason: string): Promise<void> {
    this.#record("move", number, to, reason);
    const t = this.#t(number);
    const from = t.status;
    t.status = to;
    t.failedRuns = 0;
    delete t.passedSha;
    if (to === "Paused") t.pausedFrom = from;
    else delete t.pausedFrom;
  }

  async setRound(number: number, round: number): Promise<void> {
    this.#record("setRound", number, round);
    this.#t(number).round = round;
  }

  async comment(number: number, body: string): Promise<void> {
    this.#record("comment", number, body);
  }

  async recordRunFailed(number: number, reason: string): Promise<void> {
    this.#record("recordRunFailed", number, reason);
    this.#t(number).failedRuns++;
  }

  async recordPassed(number: number, sha: string): Promise<void> {
    this.#record("recordPassed", number, sha);
    this.#t(number).passedSha = sha;
  }

  async comments(number: number): Promise<string[]> {
    this.#record("comments", number);
    return [];
  }
}

/** An agent that returns queued outcomes, or `fallback` when the queue is empty. */
export class FakeAgent implements AgentAdapter {
  readonly runs: AgentRunInput[] = [];
  readonly queue: (AgentRunOutcome | ((input: AgentRunInput) => AgentRunOutcome))[];
  fallback: (input: AgentRunInput) => AgentRunOutcome;

  constructor(...queue: (AgentRunOutcome | ((input: AgentRunInput) => AgentRunOutcome))[]) {
    this.queue = queue;
    this.fallback = () => ({ kind: "no-result", error: "no FOREMAN-RESULT block", transcript: "" });
  }

  async run(input: AgentRunInput): Promise<AgentRunOutcome> {
    this.runs.push(input);
    const next = this.queue.shift();
    if (!next) return this.fallback(input);
    return typeof next === "function" ? next(input) : next;
  }
}

/** Worktrees that only record calls. */
export class FakeWorktrees implements Worktrees {
  readonly calls: { method: "prepare" | "remove"; args: unknown[] }[] = [];

  async prepare(ticket: number, stage: StageName): Promise<PreparedWorktree> {
    this.calls.push({ method: "prepare", args: [ticket, stage] });
    return { path: `/runs/ticket-${ticket}-${stage}`, branch: `foreman/ticket-${ticket}`, headSha: "abc123" };
  }

  async remove(path: string): Promise<void> {
    this.calls.push({ method: "remove", args: [path] });
  }
}
