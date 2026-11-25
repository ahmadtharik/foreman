// In-memory fakes for the board, the agents, the worktrees and the pull requests. No network, git or Claude Code.
import type { AgentAdapter, AgentRunInput, AgentRunOutcome } from "../src/agent/types.ts";
import { formatClaim, formatMove, formatPassed, formatRelease, formatRunFailed } from "../src/board/comments.ts";
import type { BoardAdapter } from "../src/board/types.ts";
import type { CiStatus, PullFiles, PullRequest, Pulls } from "../src/github/pulls.ts";
import type { PreparedWorktree, Worktrees } from "../src/runner/worktree.ts";
import { parseTicket } from "../src/ticket.ts";
import type { Claim, StageName, Status, Ticket } from "../src/types.ts";

/** A ticket body that matches the template, with the given dependencies, test case ids and files. */
export function ticketBody(dependencies: number[] = [], cases: string[] = ["1"], files: string[] = ["src/x.ts"]): string {
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
    ...cases.map((id) => `| ${id} | check | Run it | It exits 0 |`),
    "## Dependencies",
    dependencies.length ? dependencies.map((d) => `- #${d}`).join("\n") : "None",
    "## Files likely touched",
    ...files.map((f) => `- ${f}`),
    "## Out of scope",
    "Everything else.",
  ].join("\n");
}

export interface FakeTicketInput {
  number: number;
  status: Status;
  deps?: number[];
  /** Test case ids; default ["1"]. */
  cases?: string[];
  /** Files likely touched; default ["src/x.ts"]. */
  files?: string[];
  rawBody?: string;
  round?: number;
  claim?: Claim;
  failedRuns?: number;
  passedSha?: string;
  pausedFrom?: Status;
}

export function fakeTicket(input: FakeTicketInput): Ticket {
  const rawBody = input.rawBody ?? ticketBody(input.deps, input.cases, input.files);
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
  /** Comment bodies per ticket, oldest first, as the GitHub board would write them. */
  readonly commentBodies = new Map<number, string[]>();
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

  /** A comment written by someone other than the runner, e.g. the reviewer's report. */
  addComment(number: number, body: string): void {
    const list = this.commentBodies.get(number) ?? [];
    list.push(body);
    this.commentBodies.set(number, list);
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
    this.addComment(number, formatClaim(t.claim));
    return structuredClone(t.claim);
  }

  async release(number: number, reason: string): Promise<void> {
    this.#record("release", number, reason);
    delete this.#t(number).claim;
    this.addComment(number, formatRelease(reason));
  }

  async move(number: number, to: Status, reason: string): Promise<void> {
    this.#record("move", number, to, reason);
    const t = this.#t(number);
    const from = t.status;
    this.addComment(number, formatMove(from, to, reason));
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
    this.addComment(number, body);
  }

  async recordRunFailed(number: number, reason: string): Promise<void> {
    this.#record("recordRunFailed", number, reason);
    this.#t(number).failedRuns++;
    this.addComment(number, formatRunFailed(reason));
  }

  async recordPassed(number: number, sha: string): Promise<void> {
    this.#record("recordPassed", number, sha);
    this.#t(number).passedSha = sha;
    this.addComment(number, formatPassed(sha));
  }

  async comments(number: number): Promise<string[]> {
    this.#record("comments", number);
    return [...(this.commentBodies.get(number) ?? [])];
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
  headSha = "abc123";

  async prepare(ticket: number, stage: StageName): Promise<PreparedWorktree> {
    this.calls.push({ method: "prepare", args: [ticket, stage] });
    return { path: `/runs/ticket-${ticket}-${stage}`, branch: `foreman/ticket-${ticket}`, headSha: this.headSha };
  }

  async remove(path: string): Promise<void> {
    this.calls.push({ method: "remove", args: [path] });
  }
}

export interface PullsCall {
  method: "forTicket" | "files" | "ciStatus" | "squashMerge";
  args: unknown[];
}

/** Pull requests in memory: one per ticket, files per pull request, CI per sha. */
export class FakePulls implements Pulls {
  readonly calls: PullsCall[] = [];
  /** The pull request `forTicket` returns, by ticket number. */
  readonly byTicket = new Map<number, PullRequest>();
  readonly filesByPr = new Map<number, PullFiles>();
  readonly ci = new Map<string, CiStatus>();
  /** When set, `squashMerge` rejects with it. */
  mergeError?: Error;

  /** Adds an open pull request for `ticket` and returns it. */
  open(ticket: number, pr: number, files: PullFiles = { paths: [], changedLines: 0 }): PullRequest {
    const p: PullRequest = {
      number: pr,
      url: `https://github.com/owner/target/pull/${pr}`,
      headRef: `foreman/ticket-${ticket}`,
      headSha: "head",
      state: "open",
    };
    this.byTicket.set(ticket, p);
    this.filesByPr.set(pr, files);
    return p;
  }

  get merges(): unknown[][] {
    return this.calls.filter((c) => c.method === "squashMerge").map((c) => c.args);
  }

  async forTicket(ticket: number): Promise<PullRequest | undefined> {
    this.calls.push({ method: "forTicket", args: [ticket] });
    const p = this.byTicket.get(ticket);
    return p && { ...p };
  }

  async files(pr: number): Promise<PullFiles> {
    this.calls.push({ method: "files", args: [pr] });
    const f = this.filesByPr.get(pr);
    if (!f) throw new Error(`no files for pull request #${pr}`);
    return structuredClone(f);
  }

  async ciStatus(sha: string): Promise<CiStatus> {
    this.calls.push({ method: "ciStatus", args: [sha] });
    return this.ci.get(sha) ?? "pending";
  }

  async squashMerge(pr: number, sha: string): Promise<void> {
    this.calls.push({ method: "squashMerge", args: [pr, sha] });
    if (this.mergeError) throw this.mergeError;
    for (const p of this.byTicket.values()) if (p.number === pr) p.state = "merged";
  }
}
