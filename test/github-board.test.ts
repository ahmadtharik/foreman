import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHubBoard } from "../src/board/github.ts";
import { formatClaim, formatRound } from "../src/board/comments.ts";

const REPO = "acme/widgets";
const API = `https://api.github.com/repos/${REPO}`;

const template = `## Summary
Do the thing.

## Context
Nothing special.

## Definition of done
- [ ] The thing is done

## Test cases
| # | Type | Steps | Expected result |
|---|------|-------|-----------------|
| 1 | check | Run npm test | All pass |
| 2 | check | Run npm run typecheck | Exits 0 |

## Dependencies
- none

## Files likely touched
- src/thing.ts

## Out of scope
Everything else.
`;

interface FakeIssue {
  number: number;
  title?: string;
  body?: string | null;
  labels: string[];
  pull_request?: unknown;
}

type Route = { status?: number; body: unknown; link?: string };

/** A fake fetch over a URL -> response map. Records each request. */
function fakeFetch(routes: Record<string, Route>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const route = routes[url];
    if (!route) return new Response("Not Found", { status: 404, statusText: "Not Found" });
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (route.link) headers.link = route.link;
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers });
  }) as typeof fetch;
  return { fn, calls };
}

const issue = (i: FakeIssue) => ({
  number: i.number,
  title: i.title ?? `Issue ${i.number}`,
  body: i.body === undefined ? template : i.body,
  labels: i.labels.map((name) => ({ name })),
  ...(i.pull_request ? { pull_request: i.pull_request } : {}),
});

function routesFor(issues: FakeIssue[], comments: Record<number, string[]> = {}): Record<string, Route> {
  const routes: Record<string, Route> = {};
  for (const i of issues) {
    routes[`${API}/issues/${i.number}`] = { body: issue(i) };
    routes[`${API}/issues/${i.number}/comments?per_page=100`] = {
      body: (comments[i.number] ?? []).map((body) => ({ body })),
    };
  }
  return routes;
}

const board = (f: typeof fetch, token = "t0ken") =>
  new GitHubBoard({ repo: REPO, token, claimTimeoutMin: 30, fetch: f });

test("get returns status, round from comments, and the parsed body", async () => {
  const { fn, calls } = fakeFetch(routesFor([{ number: 5, labels: ["status: qa"] }], { 5: [formatRound(2)] }));
  const t = await board(fn).get(5);
  assert.equal(t.number, 5);
  assert.equal(t.title, "Issue 5");
  assert.equal(t.status, "QA");
  assert.equal(t.round, 2);
  assert.equal(t.rawBody, template);
  assert.equal(t.body?.testCases.length, 2);
  assert.equal(t.parseError, undefined);
  assert.equal(t.claim, undefined);
  assert.equal(calls[0]!.headers.Authorization, "Bearer t0ken");
  assert.equal(calls[0]!.headers.Accept, "application/vnd.github+json");
  assert.equal(calls[0]!.headers["X-GitHub-Api-Version"], "2022-11-28");
  assert.equal(calls[0]!.headers["User-Agent"], "foreman");
});

test("get rejects an issue with no status label", async () => {
  const { fn } = fakeFetch(routesFor([{ number: 7, labels: ["bug"] }]));
  await assert.rejects(board(fn).get(7), /#7 has no single status label/);
});

test("get rejects an issue with two status labels", async () => {
  const { fn } = fakeFetch(routesFor([{ number: 8, labels: ["status: ready", "status: qa"] }]));
  await assert.rejects(board(fn).get(8), /#8 has no single status label/);
});

test("get flags an unparseable body instead of throwing", async () => {
  const { fn } = fakeFetch(routesFor([{ number: 9, labels: ["status: ready"], body: "hello" }]));
  const t = await board(fn).get(9);
  assert.equal(t.status, "Ready");
  assert.equal(t.body, null);
  assert.equal(t.rawBody, "hello");
  assert.match(t.parseError ?? "", /missing headings/);
});

test("get takes the claim from comments alone, with no claim label", async () => {
  const at = new Date("2026-11-18T10:00:00.000Z");
  const { fn } = fakeFetch(
    routesFor([{ number: 11, labels: ["status: in progress"] }], {
      11: ["just a human comment", formatClaim({ by: "runner-1", stage: "build", at })],
    }),
  );
  const t = await board(fn).get(11);
  assert.equal(t.claim?.by, "runner-1");
  assert.equal(t.claim?.stage, "build");
  assert.equal(t.claim?.at.getTime(), at.getTime());
});

test("get follows pagination of comments", async () => {
  const routes = routesFor([{ number: 12, labels: ["status: qa"] }]);
  const page2 = `${API}/issues/12/comments?per_page=100&page=2`;
  routes[`${API}/issues/12/comments?per_page=100`] = {
    body: [{ body: formatRound(2) }],
    link: `<${page2}>; rel="next", <${page2}>; rel="last"`,
  };
  routes[page2] = { body: [{ body: formatRound(3) }] };
  const { fn } = fakeFetch(routes);
  assert.equal((await board(fn).get(12)).round, 3);
});

function listRoutes(extraPage1: FakeIssue[] = []) {
  const page1Issues: FakeIssue[] = [
    { number: 1, labels: ["status: ready"] },
    { number: 2, labels: ["bug"] },
    { number: 3, labels: ["status: ready"], pull_request: { url: "x" } },
    ...extraPage1,
  ];
  const page2Issues: FakeIssue[] = [{ number: 4, labels: ["status: qa"] }];
  const routes = routesFor([...page1Issues, ...page2Issues]);
  const page2 = `${API}/issues?state=open&per_page=100&page=2`;
  routes[`${API}/issues?state=open&per_page=100`] = {
    body: page1Issues.map(issue),
    link: `<${page2}>; rel="next", <${page2}>; rel="last"`,
  };
  routes[page2] = { body: page2Issues.map(issue), link: `<${API}/issues?state=open&per_page=100>; rel="prev"` };
  return routes;
}

test("list skips pull requests and unlabelled issues, follows pagination, and filters by status", async () => {
  const { fn } = fakeFetch(listRoutes());
  const all = await board(fn).list();
  assert.deepEqual(
    all.map((t) => [t.number, t.status]),
    [
      [1, "Ready"],
      [4, "QA"],
    ],
  );
  const qa = await board(fn).list({ statuses: ["QA"] });
  assert.deepEqual(
    qa.map((t) => t.number),
    [4],
  );
});

test("list includes tickets with unparseable bodies, flagged", async () => {
  const { fn } = fakeFetch(listRoutes([{ number: 6, labels: ["status: ready"], body: "hello" }]));
  const all = await board(fn).list();
  const bad = all.find((t) => t.number === 6);
  assert.ok(bad);
  assert.equal(bad.body, null);
  assert.match(bad.parseError ?? "", /missing headings/);
  assert.equal(all.find((t) => t.number === 1)?.parseError, undefined);
});

test("a non-2xx response rejects with the status code and never the token", async () => {
  const token = "secret-token-123";
  const fn = (async () =>
    new Response(`{"message":"Not Found","token":"${token}"}`, { status: 404, statusText: "Not Found" })) as typeof fetch;
  await assert.rejects(board(fn, token).get(5), (e: Error) => {
    assert.match(e.message, /404/);
    assert.ok(!e.message.includes(token));
    return true;
  });
  await assert.rejects(board(fn, token).list(), (e: Error) => e.message.includes("404") && !e.message.includes(token));
});

test("write methods are stubs", async () => {
  const { fn } = fakeFetch({});
  await assert.rejects(board(fn).move(1, "QA", "x"), /not implemented/);
});
