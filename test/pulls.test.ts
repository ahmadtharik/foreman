import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHubPulls } from "../src/github/pulls.ts";

const REPO = "acme/widgets";
const API = `https://api.github.com/repos/${REPO}`;

type Route = { status?: number; body: unknown; link?: string };

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/** A fake fetch over a route map. Keys are "METHOD url", or a bare url for GET. */
function fakeFetch(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const call: Call = { method, url, headers: (init?.headers ?? {}) as Record<string, string> };
    if (typeof init?.body === "string") call.body = init.body;
    calls.push(call);
    const route = routes[`${method} ${url}`] ?? (method === "GET" ? routes[url] : undefined);
    if (!route) return new Response("Not Found", { status: 404, statusText: "Not Found" });
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (route.link) headers.link = route.link;
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers });
  }) as typeof fetch;
  return { fn, calls };
}

const pull = (number: number, state: "open" | "closed", merged = false) => ({
  number,
  html_url: `https://github.com/${REPO}/pull/${number}`,
  state,
  merged_at: merged ? "2026-01-01T00:00:00Z" : null,
  head: { ref: "foreman/ticket-3", sha: `sha${number}` },
});

const pullsUrl = (n: number) =>
  `${API}/pulls?head=${encodeURIComponent(`acme:foreman/ticket-${n}`)}&state=all&per_page=100`;

const make = (routes: Record<string, Route>, token = "t") => {
  const f = fakeFetch(routes);
  return { pulls: new GitHubPulls({ repo: REPO, token, fetch: f.fn }), calls: f.calls };
};

test("forTicket prefers open over merged and ignores closed unmerged", async () => {
  const { pulls, calls } = make({
    [pullsUrl(3)]: { body: [pull(4, "closed"), pull(5, "closed", true), pull(7, "open")] },
    [pullsUrl(8)]: { body: [pull(4, "closed")] },
  });
  const pr = await pulls.forTicket(3);
  assert.equal(pr?.number, 7);
  assert.equal(pr?.state, "open");
  assert.equal(pr?.headRef, "foreman/ticket-3");
  assert.equal(pr?.headSha, "sha7");
  assert.equal(pr?.url, `https://github.com/${REPO}/pull/7`);
  assert.equal(await pulls.forTicket(8), undefined);
  assert.equal(calls[0]!.headers.Authorization, "Bearer t");
  assert.equal(calls[0]!.headers["User-Agent"], "foreman");
});

test("forTicket falls back to the highest-numbered merged one", async () => {
  const { pulls } = make({
    [pullsUrl(3)]: { body: [pull(5, "closed", true), pull(9, "closed", true), pull(10, "closed")] },
  });
  const pr = await pulls.forTicket(3);
  assert.equal(pr?.number, 9);
  assert.equal(pr?.state, "merged");
});

test("files follows pagination and sums additions and deletions", async () => {
  const page1 = `${API}/pulls/7/files?per_page=100`;
  const page2 = `${API}/pulls/7/files?per_page=100&page=2`;
  const { pulls } = make({
    [page1]: { body: [{ filename: "a.ts", additions: 10, deletions: 2 }], link: `<${page2}>; rel="next", <${page2}>; rel="last"` },
    [page2]: { body: [{ filename: "b.ts", additions: 0, deletions: 5 }] },
  });
  const files = await pulls.files(7);
  assert.deepEqual(files.paths, ["a.ts", "b.ts"]);
  assert.equal(files.changedLines, 17);
});

test("ciStatus applies the green, red and pending rules", async () => {
  const run = (status: string, conclusion: string | null = null) => ({ status, conclusion });
  const cases: [unknown[], string][] = [
    [[], "pending"],
    [[run("completed", "success"), run("in_progress")], "pending"],
    [[run("completed", "success"), run("completed", "failure")], "red"],
    [[run("completed", "success"), run("completed", "skipped")], "green"],
    [[run("queued"), run("completed", "timed_out")], "red"],
  ];
  for (const [runs, expected] of cases) {
    const { pulls } = make({
      [`${API}/commits/abc/check-runs?per_page=100`]: { body: { total_count: runs.length, check_runs: runs } },
    });
    assert.equal(await pulls.ciStatus("abc"), expected, JSON.stringify(runs));
  }
});

test("squashMerge sends one PUT with squash and the sha", async () => {
  const { pulls, calls } = make({ [`PUT ${API}/pulls/7/merge`]: { body: { merged: true } } });
  await pulls.squashMerge(7, "abc");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, "PUT");
  assert.ok(calls[0]!.url.endsWith("/pulls/7/merge"));
  assert.equal(calls[0]!.body, JSON.stringify({ merge_method: "squash", sha: "abc" }));
});

test("a non-2xx response rejects with the status and not the token", async () => {
  const token = "secret-token-123";
  const { pulls } = make(
    { [`PUT ${API}/pulls/7/merge`]: { status: 409, body: { message: `Head branch was modified ${token}` } } },
    token,
  );
  await assert.rejects(pulls.squashMerge(7, "abc"), (e: Error) => {
    assert.match(e.message, /409/);
    assert.ok(!e.message.includes(token));
    return true;
  });
});
