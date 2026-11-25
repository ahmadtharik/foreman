import { spawn } from "node:child_process";
import path from "node:path";
import type { StageName } from "../types.ts";

export interface GitResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs git with `args` in `cwd`. Resolves even when git exits non-zero. */
export type GitRunner = (args: string[], cwd: string) => Promise<GitResult>;

export interface PreparedWorktree {
  path: string;
  branch: string;
  headSha: string;
}

/** One git worktree of the target repo per agent run. */
export interface Worktrees {
  prepare(ticket: number, stage: StageName): Promise<PreparedWorktree>;
  remove(path: string): Promise<void>;
}

export interface GitWorktreesOptions {
  /** A clone of the target repo with an `origin` remote. */
  repoPath: string;
  /** Directory that holds the per-run worktrees. */
  root: string;
  git?: GitRunner;
}

export class GitWorktrees implements Worktrees {
  private readonly repoPath: string;
  private readonly root: string;
  private readonly git: GitRunner;

  constructor(opts: GitWorktreesOptions) {
    this.repoPath = opts.repoPath;
    this.root = opts.root;
    this.git = opts.git ?? spawnGit;
  }

  async prepare(ticket: number, stage: StageName): Promise<PreparedWorktree> {
    const branch = `foreman/ticket-${ticket}`;
    const wtPath = path.join(this.root, `ticket-${ticket}-${stage}-${Date.now()}`);

    await this.run(["fetch", "origin"], this.repoPath);
    await this.run(["worktree", "prune"], this.repoPath);
    const remoteExists = await this.refExists(`refs/remotes/origin/${branch}`);

    if (stage === "build") {
      const start = remoteExists ? `origin/${branch}` : "origin/main";
      await this.run(["worktree", "add", "-B", branch, wtPath, start], this.repoPath);
    } else {
      if (!remoteExists) throw new Error(`no branch origin/${branch} to review`);
      await this.run(["worktree", "add", "--detach", wtPath, `origin/${branch}`], this.repoPath);
    }

    const headSha = (await this.run(["rev-parse", "HEAD"], wtPath)).stdout.trim();
    return { path: wtPath, branch, headSha };
  }

  async remove(wtPath: string): Promise<void> {
    await this.run(["worktree", "remove", "--force", wtPath], this.repoPath);
  }

  private async refExists(ref: string): Promise<boolean> {
    const r = await this.git(["rev-parse", "--verify", "--quiet", ref], this.repoPath);
    return r.code === 0;
  }

  private async run(args: string[], cwd: string): Promise<GitResult> {
    const r = await this.git(args, cwd);
    if (r.code !== 0) {
      throw new Error(`git ${args.join(" ")} failed (exit ${r.code}): ${r.stderr.trim()}`);
    }
    return r;
  }
}

function spawnGit(args: string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
