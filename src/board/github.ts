import type { Claim, StageName, Status, Ticket } from "../types.ts";
import { parseTicket } from "../ticket.ts";
import { boardState } from "./comments.ts";
import { statusFromLabels } from "./labels.ts";
import type { BoardAdapter } from "./types.ts";

export interface GitHubBoardOptions {
  /** "owner/name" */
  repo: string;
  token: string;
  claimTimeoutMin: number;
  fetch?: typeof fetch;
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

/** GitHub Issues as the board. Status is a label; round and claim come from comments. */
export class GitHubBoard implements BoardAdapter {
  readonly repo: string;
  readonly claimTimeoutMin: number;
  readonly #token: string;
  readonly #fetch: typeof fetch;

  constructor(opts: GitHubBoardOptions) {
    this.repo = opts.repo;
    this.claimTimeoutMin = opts.claimTimeoutMin;
    this.#token = opts.token;
    this.#fetch = opts.fetch ?? globalThis.fetch;
  }

  async #request(url: string): Promise<Response> {
    const res = await this.#fetch(url, {
      headers: {
        Authorization: `Bearer ${this.#token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "foreman",
      },
    });
    if (!res.ok) {
      const path = url.startsWith(API) ? url.slice(API.length) : url;
      const text = (await res.text().catch(() => "")).slice(0, 200);
      const msg = `GitHub GET ${path} failed: ${res.status} ${res.statusText} ${text}`.trim();
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

  async #toTicket(issue: Issue, status: Status): Promise<Ticket> {
    const comments = await this.#all<Comment>(
      `${API}/repos/${this.repo}/issues/${issue.number}/comments?per_page=100`,
    );
    const { round, claim } = boardState(comments.map((c) => c.body ?? ""));
    const rawBody = issue.body ?? "";
    const ticket: Ticket = { number: issue.number, title: issue.title, status, body: null, rawBody, round };
    if (claim) ticket.claim = claim;
    try {
      ticket.body = parseTicket(rawBody);
    } catch (e) {
      ticket.parseError = (e as Error).message;
    }
    return ticket;
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

  async create(_input: { title: string; body: string; status: Status }): Promise<Ticket> {
    throw new Error("not implemented");
  }

  async claim(_number: number, _stage: StageName, _by: string): Promise<Claim> {
    throw new Error("not implemented");
  }

  async release(_number: number, _reason: string): Promise<void> {
    throw new Error("not implemented");
  }

  async move(_number: number, _to: Status, _reason: string): Promise<void> {
    throw new Error("not implemented");
  }

  async setRound(_number: number, _round: number): Promise<void> {
    throw new Error("not implemented");
  }

  async comment(_number: number, _body: string): Promise<void> {
    throw new Error("not implemented");
  }
}
