export type PullState = "open" | "merged" | "closed";
export type CiStatus = "green" | "red" | "pending";

export interface PullRequest {
  number: number;
  url: string;
  headRef: string;
  headSha: string;
  state: PullState;
}

export interface PullFiles {
  paths: string[];
  /** Sum of additions and deletions across every file. */
  changedLines: number;
}

/** The pull request operations the runner needs. */
export interface Pulls {
  /** The ticket's pull request on branch `foreman/ticket-<n>`: newest open, else newest merged, else undefined. */
  forTicket(ticket: number): Promise<PullRequest | undefined>;
  files(pr: number): Promise<PullFiles>;
  ciStatus(sha: string): Promise<CiStatus>;
  squashMerge(pr: number, sha: string): Promise<void>;
}

export interface GitHubPullsOptions {
  /** "owner/name" */
  repo: string;
  token: string;
  fetch?: typeof fetch;
}

interface ApiPull {
  number: number;
  html_url: string;
  state: string;
  merged_at: string | null;
  head: { ref: string; sha: string };
}

interface ApiFile {
  filename: string;
  additions: number;
  deletions: number;
}

interface ApiCheckRun {
  status: string;
  conclusion: string | null;
}

const API = "https://api.github.com";

const FAILED = new Set(["failure", "cancelled", "timed_out", "action_required", "startup_failure"]);

/** Next page URL from a `Link` header, if any. */
function nextLink(link: string | null): string | undefined {
  if (!link) return undefined;
  for (const part of link.split(",")) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (m) return m[1];
  }
  return undefined;
}

function toPullRequest(p: ApiPull): PullRequest {
  const state: PullState = p.merged_at ? "merged" : p.state === "open" ? "open" : "closed";
  return { number: p.number, url: p.html_url, headRef: p.head.ref, headSha: p.head.sha, state };
}

/** Newest first among those matching `state`. */
function newest(pulls: PullRequest[], state: PullState): PullRequest | undefined {
  return pulls.filter((p) => p.state === state).sort((a, b) => b.number - a.number)[0];
}

/** Pull requests through the GitHub REST API. */
export class GitHubPulls implements Pulls {
  readonly repo: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;

  constructor(opts: GitHubPullsOptions) {
    this.repo = opts.repo;
    this.#token = opts.token;
    this.#fetch = opts.fetch ?? globalThis.fetch;
  }

  /** Rejects on a non-2xx status with the status code, never the token. */
  async #request(url: string, method = "GET", body?: unknown): Promise<Response> {
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
    if (!res.ok) {
      const path = url.startsWith(API) ? url.slice(API.length) : url;
      const text = (await res.text().catch(() => "")).slice(0, 200);
      const msg = `GitHub ${method} ${path} failed: ${res.status} ${res.statusText} ${text}`.trim();
      throw new Error(this.#token ? msg.split(this.#token).join("***") : msg);
    }
    return res;
  }

  /** Every page of `url`, following `Link: rel="next"`; `items` picks the list out of each page. */
  async #pages<T>(url: string, items: (page: any) => T[]): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = url;
    while (next) {
      const res = await this.#request(next);
      out.push(...items(await res.json()));
      next = nextLink(res.headers.get("link"));
    }
    return out;
  }

  async forTicket(ticket: number): Promise<PullRequest | undefined> {
    const owner = this.repo.split("/")[0];
    const head = encodeURIComponent(`${owner}:foreman/ticket-${ticket}`);
    const url = `${API}/repos/${this.repo}/pulls?head=${head}&state=all&per_page=100`;
    const pulls = (await this.#pages<ApiPull>(url, (p) => p)).map(toPullRequest);
    return newest(pulls, "open") ?? newest(pulls, "merged");
  }

  async files(pr: number): Promise<PullFiles> {
    const url = `${API}/repos/${this.repo}/pulls/${pr}/files?per_page=100`;
    const files = await this.#pages<ApiFile>(url, (p) => p);
    return {
      paths: files.map((f) => f.filename),
      changedLines: files.reduce((sum, f) => sum + f.additions + f.deletions, 0),
    };
  }

  async ciStatus(sha: string): Promise<CiStatus> {
    const url = `${API}/repos/${this.repo}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`;
    const runs = await this.#pages<ApiCheckRun>(url, (p) => p.check_runs ?? []);
    if (runs.length === 0) return "pending";
    if (runs.some((r) => r.status === "completed" && r.conclusion !== null && FAILED.has(r.conclusion))) return "red";
    if (runs.some((r) => r.status !== "completed")) return "pending";
    return "green";
  }

  async squashMerge(pr: number, sha: string): Promise<void> {
    await this.#request(`${API}/repos/${this.repo}/pulls/${pr}/merge`, "PUT", { merge_method: "squash", sha });
  }
}
