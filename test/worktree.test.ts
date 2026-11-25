import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { GitWorktrees, type GitResult } from "../src/runner/worktree.ts";

const REPO = "/repo";
const ROOT = "/runs";

interface Call {
  args: string[];
  cwd: string;
}

/** Fake git: `respond` picks the result for each call; default is success. */
function fakeGit(respond: (args: string[]) => Partial<GitResult> = () => ({})) {
  const calls: Call[] = [];
  const git = async (args: string[], cwd: string): Promise<GitResult> => {
    calls.push({ args, cwd });
    return { code: 0, stdout: "", stderr: "", ...respond(args) };
  };
  return { git, calls };
}

const isVerify = (args: string[]) => args[0] === "rev-parse" && args[1] === "--verify";
const isHead = (args: string[]) => args.join(" ") === "rev-parse HEAD";

test("build with no remote branch starts a new branch at origin/main", async () => {
  const { git, calls } = fakeGit((args) => {
    if (isVerify(args)) return { code: 1 };
    if (isHead(args)) return { stdout: "abc123\n" };
    return {};
  });
  const r = await new GitWorktrees({ repoPath: REPO, root: ROOT, git }).prepare(3, "build");

  assert.equal(r.branch, "foreman/ticket-3");
  assert.equal(r.headSha, "abc123");
  assert.equal(path.dirname(r.path), path.join(ROOT));
  assert.match(path.basename(r.path), /^ticket-3-build-\d+$/);
  assert.deepEqual(
    calls.map((c) => c.args),
    [
      ["fetch", "origin"],
      ["worktree", "prune"],
      ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/foreman/ticket-3"],
      ["worktree", "add", "-B", "foreman/ticket-3", r.path, "origin/main"],
      ["rev-parse", "HEAD"],
    ],
  );
  assert.deepEqual(
    calls.map((c) => c.cwd),
    [REPO, REPO, REPO, REPO, r.path],
  );
});

test("build with a remote branch continues it at its remote tip", async () => {
  const { git, calls } = fakeGit((args) => (isHead(args) ? { stdout: "def456\n" } : {}));
  const r = await new GitWorktrees({ repoPath: REPO, root: ROOT, git }).prepare(4, "build");

  assert.equal(r.headSha, "def456");
  assert.deepEqual(calls[3]!.args, ["worktree", "add", "-B", "foreman/ticket-4", r.path, "origin/foreman/ticket-4"]);
});

test("review gets a detached worktree at the remote branch", async () => {
  const { git, calls } = fakeGit((args) => (isHead(args) ? { stdout: "fff000\n" } : {}));
  const r = await new GitWorktrees({ repoPath: REPO, root: ROOT, git }).prepare(5, "review");

  assert.equal(r.branch, "foreman/ticket-5");
  assert.equal(r.headSha, "fff000");
  assert.match(path.basename(r.path), /^ticket-5-review-\d+$/);
  assert.deepEqual(calls[3]!.args, ["worktree", "add", "--detach", r.path, "origin/foreman/ticket-5"]);
});

test("review with no remote branch rejects and adds no worktree", async () => {
  const { git, calls } = fakeGit((args) => (isVerify(args) ? { code: 1 } : {}));
  await assert.rejects(new GitWorktrees({ repoPath: REPO, root: ROOT, git }).prepare(2, "review"), {
    message: "no branch origin/foreman/ticket-2 to review",
  });
  assert.ok(!calls.some((c) => c.args[0] === "worktree" && c.args[1] === "add"));
});

test("remove runs worktree remove --force in the repo", async () => {
  const { git, calls } = fakeGit();
  await new GitWorktrees({ repoPath: REPO, root: ROOT, git }).remove("/runs/ticket-1-build-1");
  assert.deepEqual(calls, [{ args: ["worktree", "remove", "--force", "/runs/ticket-1-build-1"], cwd: REPO }]);
});

test("a failing git command rejects with the command and its stderr", async () => {
  const { git } = fakeGit(() => ({ code: 128, stderr: "fatal: '/nope' is not a working tree\n" }));
  await assert.rejects(new GitWorktrees({ repoPath: REPO, root: ROOT, git }).remove("/nope"), (e: Error) => {
    assert.match(e.message, /git worktree remove --force \/nope/);
    assert.match(e.message, /fatal: '\/nope' is not a working tree/);
    return true;
  });
});

test("a failing fetch stops prepare before any worktree is added", async () => {
  const { git, calls } = fakeGit((args) => (args[0] === "fetch" ? { code: 1, stderr: "could not read from remote" } : {}));
  await assert.rejects(new GitWorktrees({ repoPath: REPO, root: ROOT, git }).prepare(1, "build"), /git fetch origin.*could not read from remote/);
  assert.equal(calls.length, 1);
});
