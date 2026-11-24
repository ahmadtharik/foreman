import type { Claim, StageName, Status, Ticket } from "../types.ts";
import { parseTicket } from "../ticket.ts";
import {
  boardState,
  formatClaim,
  formatMove,
  formatPassed,
  formatRelease,
  formatRound,
  formatRunFailed,
  type BoardState,
} from "./comments.ts";
import { CLAIM_LABEL, STATUS_LABELS, statusFromLabels } from "./labels.ts";
import type { BoardAdapter } from "./types.ts";

export interface GitHubBoardOptions {
  /** "owner/name" */
  repo: string;
  token: string;
  claimTimeoutMin: number;
  fetch?: typeof fetch;
  /** Clock for claim times and staleness; defaults to the system clock. */
  now?: () => Date;
}

interface Issue {
  number: number;
  title: string;
  body: string | null;
  labels: (string | { name?: string })[];
  pull_request?: unknown;
}

interface Comment {
  body: string | null;
}

const API = "https://api.github.com";

/** Next page URL from a `Link` header, if any. */
function nextLink(link: string | null): string | undefined {
  if (!link) return undefined;
  for (const part of link.split(",")) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (m) return m[1];
  }
  return undefined;
}

const labelNames = (issue: Issue): string[] =>
  issue.labels.map((l) => (typeof l === "string" ? l : (l.name ?? "")));

/** A Ticket from an issue, with the body parsed or flagged as unparseable. */
function withBody(issue: Issue, status: Status, round: number): Ticket {
  const rawBody = issue.body ?? "";
  const ticket: Ticket = { number: issue.number, title: issue.title, status, body: null, rawBody, round, failedRuns: 0 };
  try {
    ticket.body = parseTicket(rawBody);
  } catch (e) {
    ticket.parseError = (e as Error).message;
  }
  return ticket;
}

/** GitHub Issues as the board. Status is a label; round and claim come from comments. */
export class GitHubBoard implements BoardAdapter {
  readonly repo: string;
  readonly claimTimeoutMin: number;
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;

  constructor(opts: GitHubBoardOptions) {
    this.repo = opts.repo;
    this.claimTimeoutMin = opts.claimTimeoutMin;
    this.#token = opts.token;
    this.#fetch = opts.fetch ?? globalThis.fetch;
    this.#now = opts.now ?? (() => new Date());
  }

  /** Rejects on a non-2xx status, except one listed in `allow`. */
  async #request(url: string, method = "GET", body?: unknown, allow: number[] = []): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "foreman",
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const res = await this.#fetch(url, init);
    if (!res.ok && !allow.includes(res.status)) {
      const path = url.startsWith(API) ? url.slice(API.length) : url;
      const text = (await res.text().catch(() => "")).slice(0, 200);
      const msg = `GitHub ${method} ${path} failed: ${res.status} ${res.statusText} ${text}`.trim();
      throw new Error(this.#token ? msg.split(this.#token).join("***") : msg);
    }
    return res;
  }

  /** Every item across `Link: rel="next"` pages. */
  async #all<T>(url: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = url;
    while (next) {
      const res = await this.#request(next);
      out.push(...((await res.json()) as T[]));
      next = nextLink(res.headers.get("link"));
    }
    return out;
  }

  async #state(number: number): Promise<BoardState> {
    return boardState(await this.comments(number));
  }

  async #toTicket(issue: Issue, status: Status): Promise<Ticket> {
    const { round, claim, failedRuns, passedSha, pausedFrom } = await this.#state(issue.number);
    const ticket = withBody(issue, status, round);
    ticket.failedRuns = failedRuns;
    if (claim) ticket.claim = claim;
    if (passedSha !== undefined) ticket.passedSha = passedSha;
    if (pausedFrom !== undefined) ticket.pausedFrom = pausedFrom;
    return ticket;
  }

  async #postComment(number: number, body: string): Promise<void> {
    await this.#request(`${API}/repos/${this.repo}/issues/${number}/comments`, "POST", { body });
  }

  async get(number: number): Promise<Ticket> {
    const res = await this.#request(`${API}/repos/${this.repo}/issues/${number}`);
    const issue = (await res.json()) as Issue;
    const status = statusFromLabels(labelNames(issue));
    if (!status) throw new Error(`#${number} has no single status label`);
    return this.#toTicket(issue, status);
  }

  async list(filter?: { statuses?: Status[] }): Promise<Ticket[]> {
    const issues = await this.#all<Issue>(`${API}/repos/${this.repo}/issues?state=open&per_page=100`);
    const tickets: Ticket[] = [];
    for (const issue of issues) {
      if (issue.pull_request) continue;
      const status = statusFromLabels(labelNames(issue));
      if (!status) continue;
      if (filter?.statuses && !filter.statuses.includes(status)) continue;
      tickets.push(await this.#toTicket(issue, status));
    }
    return tickets;
  }

  async create(input: { title: string; body: string; status: Status }): Promise<Ticket> {
    const res = await this.#request(`${API}/repos/${this.repo}/issues`, "POST", {
      title: input.title,
      body: input.body,
      labels: [STATUS_LABELS[input.status].name],
    });
    const issue = (await res.json()) as Issue;
    return withBody(issue, input.status, 1);
  }

  /** Check-then-write: fails while a claim younger than `claimTimeoutMin` exists; a stale one is replaced. */
  async claim(number: number, stage: StageName, by: string): Promise<Claim> {
    const now = this.#now();
    const { claim: current } = await this.#state(number);
    if (current && now.getTime() - current.at.getTime() < this.claimTimeoutMin * 60_000) {
      throw new Error(
        `#${number} is already claimed by ${current.by} for ${current.stage} since ${current.at.toISOString()}`,
      );
    }
    const claim: Claim = { by, stage, at: now };
    await this.#request(`${API}/repos/${this.repo}/issues/${number}/labels`, "POST", { labels: [CLAIM_LABEL.name] });
    await this.#postComment(number, formatClaim(claim));
    return claim;
  }

  /** A 404 on removing the label (already gone) is not an error. */
  async release(number: number, reason: string): Promise<void> {
    const url = `${API}/repos/${this.repo}/issues/${number}/labels/${encodeURIComponent(CLAIM_LABEL.name)}`;
    await this.#request(url, "DELETE", undefined, [404]);
    await this.#postComment(number, formatRelease(reason));
  }

  /** Removes every status label present (so it also recovers a ticket with none or two), keeps other labels. */
  async move(number: number, to: Status, reason: string): Promise<void> {
    const issueUrl = `${API}/repos/${this.repo}/issues/${number}`;
    const issue = (await (await this.#request(issueUrl)).json()) as Issue;
    const labels = labelNames(issue);
    const from = statusFromLabels(labels) ?? null;
    const statusNames = new Set(Object.values(STATUS_LABELS).map((l) => l.name));
    for (const name of labels.filter((l) => statusNames.has(l))) {
      await this.#request(`${issueUrl}/labels/${encodeURIComponent(name)}`, "DELETE");
    }
    await this.#request(`${issueUrl}/labels`, "POST", { labels: [STATUS_LABELS[to].name] });
    await this.#postComment(number, formatMove(from, to, reason));
  }

  async setRound(number: number, round: number): Promise<void> {
    if (!Number.isInteger(round) || round < 1) {
      throw new Error(`round must be a positive whole number, got ${round}`);
    }
    await this.#postComment(number, formatRound(round));
  }

  async comment(number: number, body: string): Promise<void> {
    await this.#postComment(number, body);
  }

  async recordRunFailed(number: number, reason: string): Promise<void> {
    await this.#postComment(number, formatRunFailed(reason));
  }

  async recordPassed(number: number, sha: string): Promise<void> {
    await this.#postComment(number, formatPassed(sha));
  }

  /** Every comment body across `Link` pages, oldest first. */
  async comments(number: number): Promise<string[]> {
    const comments = await this.#all<Comment>(`${API}/repos/${this.repo}/issues/${number}/comments?per_page=100`);
    return comments.map((c) => c.body ?? "");
  }
}
