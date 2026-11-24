import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHubBoard } from "../src/board/github.ts";
import {
  formatClaim,
  formatMove,
  formatPassed,
  formatRound,
  formatRunFailed,
  parseComment,
} from "../src/board/comments.ts";

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

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: any; // parsed JSON request body
}

/**
 * A fake fetch over a route map. Keys are "METHOD url", or a bare url for GET.
 * Records each request with its method and parsed JSON body.
 */
function fakeFetch(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const call: Call = { method, url, headers: (init?.headers ?? {}) as Record<string, string> };
    if (typeof init?.body === "string") call.body = JSON.parse(init.body);
    calls.push(call);
    const route = routes[`${method} ${url}`] ?? (method === "GET" ? routes[url] : undefined);
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

// Write methods use the repo from the ticket's test cases.
const WREPO = "o/r";
const WAPI = `https://api.github.com/repos/${WREPO}`;
const wboard = (f: typeof fetch) => new GitHubBoard({ repo: WREPO, token: "t0ken", claimTimeoutMin: 30, fetch: f });
const writes = <T extends { method: string }>(calls: T[]) => calls.filter((c) => c.method !== "GET");

test("create posts title, body and the single status label, and returns status and round 1", async () => {
  const { fn, calls } = fakeFetch({
    [`POST ${WAPI}/issues`]: {
      status: 201,
      body: { number: 21, title: "T", body: template, labels: [{ name: "status: backlog" }] },
    },
  });
  const t = await wboard(fn).create({ title: "T", body: template, status: "Backlog" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.url, `${WAPI}/issues`);
  assert.deepEqual(calls[0]!.body, { title: "T", body: template, labels: ["status: backlog"] });
  assert.equal(calls[0]!.headers["Content-Type"], "application/json");
  assert.equal(t.number, 21);
  assert.equal(t.title, "T");
  assert.equal(t.status, "Backlog");
  assert.equal(t.round, 1);
  assert.equal(t.body?.testCases.length, 2);
});

test("move replaces the status label, keeps other labels, and posts a parseable move comment", async () => {
  const { fn, calls } = fakeFetch({
    [`${WAPI}/issues/3`]: { body: issue({ number: 3, labels: ["bug", "status: ready"] }) },
    [`DELETE ${WAPI}/issues/3/labels/status%3A%20ready`]: { body: [{ name: "bug" }] },
    [`POST ${WAPI}/issues/3/labels`]: { body: [{ name: "bug" }, { name: "status: qa" }] },
    [`POST ${WAPI}/issues/3/comments`]: { status: 201, body: {} },
  });
  await wboard(fn).move(3, "QA", "built");
  const w = writes(calls);
  assert.deepEqual(
    w.map((c) => `${c.method} ${c.url}`),
    [
      `DELETE ${WAPI}/issues/3/labels/status%3A%20ready`,
      `POST ${WAPI}/issues/3/labels`,
      `POST ${WAPI}/issues/3/comments`,
    ],
  );
  assert.ok(!calls.some((c) => c.method === "DELETE" && c.url.endsWith("/labels/bug")));
  assert.deepEqual(w[1]!.body, { labels: ["status: qa"] });
  assert.deepEqual(parseComment(w[2]!.body.body), { kind: "move", from: "Ready", to: "QA", reason: "built" });
});

test("move removes both status labels when there are two, and records from as null", async () => {
  const { fn, calls } = fakeFetch({
    [`${WAPI}/issues/4`]: { body: issue({ number: 4, labels: ["status: ready", "status: qa"] }) },
    [`DELETE ${WAPI}/issues/4/labels/status%3A%20ready`]: { body: [] },
    [`DELETE ${WAPI}/issues/4/labels/status%3A%20qa`]: { body: [] },
    [`POST ${WAPI}/issues/4/labels`]: { body: [] },
    [`POST ${WAPI}/issues/4/comments`]: { status: 201, body: {} },
  });
  await wboard(fn).move(4, "Needs human", "recovered");
  const w = writes(calls);
  assert.equal(w.filter((c) => c.method === "DELETE").length, 2);
  assert.deepEqual(w[2]!.body, { labels: ["status: needs human"] });
  assert.deepEqual(parseComment(w[3]!.body.body), {
    kind: "move",
    from: null,
    to: "Needs human",
    reason: "recovered",
  });
});

test("move with no status label deletes nothing and records from as null", async () => {
  const { fn, calls } = fakeFetch({
    [`${WAPI}/issues/5`]: { body: issue({ number: 5, labels: ["bug"] }) },
    [`POST ${WAPI}/issues/5/labels`]: { body: [] },
    [`POST ${WAPI}/issues/5/comments`]: { status: 201, body: {} },
  });
  await wboard(fn).move(5, "Backlog", "first status");
  const w = writes(calls);
  assert.deepEqual(
    w.map((c) => c.method),
    ["POST", "POST"],
  );
  assert.deepEqual(parseComment(w[1]!.body.body), { kind: "move", from: null, to: "Backlog", reason: "first status" });
});

test("setRound posts a round comment that get reads back", async () => {
  const routes: Record<string, Route> = {
    [`${WAPI}/issues/3`]: { body: issue({ number: 3, labels: ["status: in progress"] }) },
    [`${WAPI}/issues/3/comments?per_page=100`]: { body: [] },
    [`POST ${WAPI}/issues/3/comments`]: { status: 201, body: {} },
  };
  const { fn: inner, calls } = fakeFetch(routes);
  // The comments listing returns whatever has been posted so far.
  const posted: string[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST" && String(input).endsWith("/comments")) {
      posted.push(JSON.parse(String(init.body)).body);
      routes[`${WAPI}/issues/3/comments?per_page=100`] = { body: posted.map((body) => ({ body })) };
    }
    return inner(input, init);
  }) as typeof fetch;
  const b = wboard(fn);
  await b.setRound(3, 2);
  assert.equal(writes(calls).length, 1);
  assert.equal((await b.get(3)).round, 2);
});

test("setRound rejects a round that is not a positive whole number and sends nothing", async () => {
  const { fn, calls } = fakeFetch({});
  await assert.rejects(wboard(fn).setRound(3, 0), /positive whole number/);
  await assert.rejects(wboard(fn).setRound(3, 1.5), /positive whole number/);
  await assert.rejects(wboard(fn).setRound(3, -1), /positive whole number/);
  assert.equal(calls.length, 0);
});

test("comment posts the body unchanged", async () => {
  const { fn, calls } = fakeFetch({ [`POST ${WAPI}/issues/3/comments`]: { status: 201, body: {} } });
  await wboard(fn).comment(3, "hello **world**");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.url, `${WAPI}/issues/3/comments`);
  assert.deepEqual(calls[0]!.body, { body: "hello **world**" });
});

test("a failed write names the method and never the token", async () => {
  const fn = (async () => new Response("t0ken", { status: 422, statusText: "Unprocessable" })) as typeof fetch;
  await assert.rejects(
    wboard(fn).comment(3, "x"),
    (e: Error) => /POST .*422/.test(e.message) && !e.message.includes("t0ken"),
  );
});

// claim and release, with the clock fixed by the `now` option.
const NOW = new Date("2026-11-18T12:00:00Z");
const cboard = (f: typeof fetch) =>
  new GitHubBoard({ repo: WREPO, token: "t0ken", claimTimeoutMin: 60, fetch: f, now: () => NOW });

/** Routes for issue 4 whose comments listing returns whatever has been posted so far. */
function liveComments(initial: string[], extra: Record<string, Route> = {}) {
  const posted = [...initial];
  const routes: Record<string, Route> = {
    [`${WAPI}/issues/4`]: { body: issue({ number: 4, labels: ["status: in progress"] }) },
    [`${WAPI}/issues/4/comments?per_page=100`]: { body: posted.map((body) => ({ body })) },
    [`POST ${WAPI}/issues/4/labels`]: { body: [] },
    [`POST ${WAPI}/issues/4/comments`]: { status: 201, body: {} },
    ...extra,
  };
  const { fn: inner, calls } = fakeFetch(routes);
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST" && String(input).endsWith("/comments")) {
      posted.push(JSON.parse(String(init.body)).body);
      routes[`${WAPI}/issues/4/comments?per_page=100`] = { body: posted.map((body) => ({ body })) };
    }
    return inner(input, init);
  }) as typeof fetch;
  return { fn, calls };
}

test("claim on an unclaimed ticket adds the claim label, posts a claim comment, and returns now", async () => {
  const { fn, calls } = liveComments([]);
  const c = await cboard(fn).claim(4, "build", "runner-1");
  assert.deepEqual(c, { by: "runner-1", stage: "build", at: new Date("2026-11-18T12:00:00.000Z") });
  assert.equal(c.at.toISOString(), "2026-11-18T12:00:00.000Z");
  const w = writes(calls);
  assert.deepEqual(
    w.map((x) => `${x.method} ${x.url}`),
    [`POST ${WAPI}/issues/4/labels`, `POST ${WAPI}/issues/4/comments`],
  );
  assert.deepEqual(w[0]!.body, { labels: ["foreman: claimed"] });
  assert.deepEqual(parseComment(w[1]!.body.body), { kind: "claim", by: "runner-1", stage: "build", at: NOW });
});

test("claim on a ticket with a fresh claim rejects and sends no write", async () => {
  const at = new Date("2026-11-18T11:30:00Z");
  const { fn, calls } = liveComments([formatClaim({ by: "runner-1", stage: "build", at })]);
  await assert.rejects(cboard(fn).claim(4, "build", "runner-2"), /already claimed by runner-1 for build/);
  assert.equal(calls.filter((c) => ["POST", "PATCH", "DELETE"].includes(c.method)).length, 0);
});

test("claim on a ticket with a stale claim succeeds and replaces it", async () => {
  const at = new Date("2026-11-18T10:59:00Z");
  const { fn } = liveComments([formatClaim({ by: "runner-1", stage: "build", at })]);
  const b = cboard(fn);
  const c = await b.claim(4, "build", "runner-2");
  assert.equal(c.by, "runner-2");
  const t = await b.get(4);
  assert.equal(t.claim?.by, "runner-2");
  assert.equal(t.claim?.at.getTime(), NOW.getTime());
});

test("a claim exactly claimTimeoutMin old is stale", async () => {
  const at = new Date("2026-11-18T11:00:00Z");
  const { fn } = liveComments([formatClaim({ by: "runner-1", stage: "review", at })]);
  assert.equal((await cboard(fn).claim(4, "build", "runner-2")).by, "runner-2");
});

test("release tolerates a 404 on the label, posts the reason, and get then has no claim", async () => {
  const at = new Date("2026-11-18T11:30:00Z");
  const { fn, calls } = liveComments([formatClaim({ by: "runner-1", stage: "build", at })], {
    [`DELETE ${WAPI}/issues/4/labels/foreman%3A%20claimed`]: { status: 404, body: { message: "Label does not exist" } },
  });
  const b = cboard(fn);
  await b.release(4, "agent timed out");
  const w = writes(calls);
  assert.deepEqual(
    w.map((x) => `${x.method} ${x.url}`),
    [`DELETE ${WAPI}/issues/4/labels/foreman%3A%20claimed`, `POST ${WAPI}/issues/4/comments`],
  );
  assert.match(w[1]!.body.body, /agent timed out/);
  assert.deepEqual(parseComment(w[1]!.body.body), { kind: "release", reason: "agent timed out" });
  assert.equal((await b.get(4)).claim, undefined);
});

test("release still rejects on a non-404 failure removing the label", async () => {
  const { fn, calls } = liveComments([], {
    [`DELETE ${WAPI}/issues/4/labels/foreman%3A%20claimed`]: { status: 500, body: {} },
  });
  await assert.rejects(cboard(fn).release(4, "x"), /DELETE .*500/);
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
});

// Failed runs, passed reviews and comments.
test("get fills failedRuns and passedSha, and comments returns every body across pages, oldest first", async () => {
  const routes = routesFor([{ number: 5, labels: ["status: qa"] }]);
  const bodies = [formatRunFailed("a"), formatRunFailed("b"), formatPassed("abc")];
  const page2 = `${API}/issues/5/comments?per_page=100&page=2`;
  routes[`${API}/issues/5/comments?per_page=100`] = {
    body: bodies.slice(0, 2).map((body) => ({ body })),
    link: `<${page2}>; rel="next", <${page2}>; rel="last"`,
  };
  routes[page2] = { body: [{ body: bodies[2] }] };
  const { fn } = fakeFetch(routes);
  const b = board(fn);
  const t = await b.get(5);
  assert.equal(t.failedRuns, 2);
  assert.equal(t.passedSha, "abc");
  assert.equal(t.pausedFrom, undefined);
  assert.deepEqual(await b.comments(5), bodies);
});

test("get fills pausedFrom, and a ticket with no events has failedRuns 0", async () => {
  const { fn } = fakeFetch(
    routesFor([{ number: 6, labels: ["status: paused"] }, { number: 7, labels: ["status: ready"] }], {
      6: [formatMove("QA", "Paused", "limit")],
    }),
  );
  const b = board(fn);
  const t = await b.get(6);
  assert.equal(t.pausedFrom, "QA");
  assert.equal(t.failedRuns, 0);
  assert.equal(t.passedSha, undefined);
  assert.equal((await b.get(7)).failedRuns, 0);
});

test("list fills failedRuns, passedSha and pausedFrom", async () => {
  const routes = listRoutes();
  routes[`${API}/issues/4/comments?per_page=100`] = {
    body: [{ body: formatMove("QA", "Paused", "limit") }, { body: formatRunFailed("x") }, { body: formatPassed("def") }],
  };
  const { fn } = fakeFetch(routes);
  const all = await board(fn).list();
  const t4 = all.find((t) => t.number === 4);
  assert.equal(t4?.failedRuns, 1);
  assert.equal(t4?.passedSha, "def");
  assert.equal(t4?.pausedFrom, "QA");
  assert.equal(all.find((t) => t.number === 1)?.failedRuns, 0);
});

test("create returns failedRuns 0", async () => {
  const { fn } = fakeFetch({
    [`POST ${API}/issues`]: { status: 201, body: issue({ number: 30, labels: ["status: backlog"] }) },
  });
  const t = await board(fn).create({ title: "T", body: template, status: "Backlog" });
  assert.equal(t.failedRuns, 0);
  assert.equal(t.passedSha, undefined);
  assert.equal(t.pausedFrom, undefined);
});

test("recordRunFailed and recordPassed each post exactly one parseable comment", async () => {
  const { fn, calls } = fakeFetch({ [`POST ${API}/issues/5/comments`]: { status: 201, body: {} } });
  const b = board(fn);
  await b.recordRunFailed(5, "crash");
  await b.recordPassed(5, "abc");
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url}`),
    [`POST ${API}/issues/5/comments`, `POST ${API}/issues/5/comments`],
  );
  assert.deepEqual(parseComment(calls[0]!.body.body), { kind: "run-failed", reason: "crash" });
  assert.deepEqual(parseComment(calls[1]!.body.body), { kind: "passed", sha: "abc" });
});
