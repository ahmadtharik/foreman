import type { AgentAdapter, AgentRunOutcome } from "../agent/types.ts";
import { parseComment } from "../board/comments.ts";
import type { BoardAdapter } from "../board/types.ts";
import type { Settings, StageConfig } from "../config.ts";
import type { Pulls } from "../github/pulls.ts";
import type { StageName, Status, Ticket } from "../types.ts";
import { checkEvidence } from "./evidence.ts";
import type { Worktrees } from "./worktree.ts";

/** One line per action: the ticket (or null), the action, and why. */
export type CycleLog = (ticket: number | null, action: string, reason: string) => void;

export interface CycleDeps {
  board: BoardAdapter;
  agents: Record<StageName, AgentAdapter>;
  worktrees: Worktrees;
  pulls: Pulls;
  settings: Settings;
  runnerId: string;
  now: () => Date;
  log: CycleLog;
  /** Log what would happen; no board write, worktree or agent call. */
  dryRun?: boolean;
  /** Strings replaced by `***` in every board text and log line. */
  secrets?: string[];
}

/** Runs in a row without a valid result that send a ticket to Needs human. */
export const MAX_FAILED_RUNS = 3;

/**
 * One pass of the runner: resume Paused tickets, promote Backlog tickets,
 * release stale claims, merge passed tickets, then pick and run at most one
 * ticket per stage.
 */
export async function runCycle(deps: CycleDeps): Promise<void> {
  const { settings, dryRun = false } = deps;
  const scrub = makeScrub(deps.secrets ?? []);
  const log: CycleLog = (n, action, reason) => deps.log(n, scrub(action), scrub(reason));
  const board = dryRun ? deps.board : scrubbedBoard(deps.board, scrub);
  const timeoutMs = settings.claimTimeoutMin * 60_000;

  const tickets = await deps.board.list();
  tickets.sort((a, b) => a.number - b.number);
  const byNumber = new Map(tickets.map((t) => [t.number, t]));
  const outside = new Map<number, Status | null>();

  const statusOf = async (n: number): Promise<Status | null> => {
    const open = byNumber.get(n);
    if (open) return open.status;
    if (!outside.has(n)) {
      try {
        outside.set(n, (await deps.board.get(n)).status);
      } catch {
        outside.set(n, null);
      }
    }
    return outside.get(n)!;
  };
  const depsDone = async (t: Ticket): Promise<boolean> => {
    for (const d of t.body?.dependencies ?? []) {
      if ((await statusOf(d)) !== "Done") return false;
    }
    return true;
  };

  // 1. Resume Paused tickets.
  for (const t of tickets.filter((t) => t.status === "Paused")) {
    const to = t.pausedFrom ?? "Ready";
    const reason = "resumed after usage limit";
    if (dryRun) log(t.number, "would resume", `to ${to}, ${reason}`);
    else if (!(await attempt(log, t.number, "resume", `to ${to}, ${reason}`, () => board.move(t.number, to, reason)))) continue;
    t.status = to;
    delete t.pausedFrom;
  }

  // 2. Promote Backlog tickets whose dependencies are all Done.
  for (const t of tickets.filter((t) => t.status === "Backlog")) {
    if (!t.body || !(await depsDone(t))) continue;
    const reason = "all dependencies Done";
    if (dryRun) log(t.number, "would promote", `to Ready, ${reason}`);
    else if (!(await attempt(log, t.number, "promote", `to Ready, ${reason}`, () => board.move(t.number, "Ready", reason)))) continue;
    t.status = "Ready";
  }

  // 3. Release stale claims.
  const now = deps.now();
  for (const t of tickets) {
    const c = t.claim;
    if (!c || now.getTime() - c.at.getTime() < timeoutMs) continue;
    const reason =
      `stale claim by ${c.by} for ${c.stage} since ${c.at.toISOString()}, ` +
      `older than ${settings.claimTimeoutMin} min`;
    if (dryRun) log(t.number, "would release", reason);
    else if (!(await attempt(log, t.number, "release", reason, () => board.release(t.number, reason)))) continue;
    delete t.claim;
  }

  // 4. Merge passed tickets (or wait for CI or a human).
  for (const t of tickets.filter((t) => t.status === "QA" && t.passedSha !== undefined)) {
    try {
      if (await mergePassed({ ...deps, board, log }, t, t.passedSha!)) t.status = "Done";
    } catch (e) {
      log(t.number, "merge check failed", (e as Error).message);
    }
  }

  // 5. Pick the lowest-numbered eligible ticket per stage.
  const picked = new Set<number>();
  const picks: { stage: StageConfig; ticket: Ticket }[] = [];
  for (const stage of settings.stages) {
    for (const t of tickets) {
      if (picked.has(t.number) || !stage.triggers.includes(t.status)) continue;
      if (t.claim || !t.body || t.passedSha !== undefined || !(await depsDone(t))) continue;
      picked.add(t.number);
      picks.push({ stage, ticket: t });
      break;
    }
  }

  if (dryRun) {
    for (const { stage, ticket } of picks) log(ticket.number, `would start ${stage.name}`, `status ${ticket.status}`);
    return;
  }

  // 6. Run the picks; stages run at the same time.
  await Promise.all(picks.map(({ stage, ticket }) => runPick({ ...deps, board, log }, stage, ticket)));
}

async function runPick(deps: CycleDeps, stage: StageConfig, ticket: Ticket): Promise<void> {
  const { board, log } = deps;
  const n = ticket.number;
  try {
    await board.claim(n, stage.name, deps.runnerId);
  } catch (e) {
    log(n, "skip", `claim failed: ${(e as Error).message}`);
    return;
  }
  log(n, `claim ${stage.name}`, `claimed by ${deps.runnerId}`);

  try {
    if (ticket.status === "Ready") {
      await board.move(n, "In progress", "build started");
      ticket.status = "In progress";
      ticket.failedRuns = 0;
    }
    let outcome: AgentRunOutcome;
    let headSha = "";
    try {
      const wt = await deps.worktrees.prepare(n, stage.name);
      headSha = wt.headSha;
      try {
        log(n, `run ${stage.name}`, `round ${ticket.round} in ${wt.path}`);
        outcome = await deps.agents[stage.name].run({
          stage: stage.name,
          skill: stage.skill,
          ticket,
          workdir: wt.path,
          round: ticket.round,
        });
      } finally {
        await attempt(log, n, "remove worktree", wt.path, () => deps.worktrees.remove(wt.path));
      }
    } catch (e) {
      outcome = { kind: "crashed", error: (e as Error).message, transcript: "" };
    }
    await applyOutcome(deps, stage, ticket, outcome, headSha);
  } catch (e) {
    log(n, "error", (e as Error).message);
  } finally {
    await attempt(log, n, "release", `${stage.name} run finished`, () => board.release(n, `${stage.name} run finished`));
  }
}

/**
 * A QA ticket with a recorded pass: Done if its pull request is merged; otherwise,
 * unless supervised, squash-merge at the tested sha once CI is green.
 * Returns true when the ticket moved to Done.
 */
async function mergePassed(deps: CycleDeps, t: Ticket, sha: string): Promise<boolean> {
  const { board, log, settings, dryRun = false } = deps;
  const n = t.number;
  const pr = await deps.pulls.forTicket(n);
  if (!pr) {
    log(n, "waiting", `no pull request on foreman/ticket-${n}`);
    return false;
  }
  if (pr.state === "merged") {
    const reason = `pull request #${pr.number} merged`;
    if (dryRun) log(n, "would move Done", reason);
    else if (!(await attempt(log, n, "move Done", reason, () => board.move(n, "Done", reason)))) return false;
    return true;
  }
  if (settings.autonomy === "supervised") {
    log(n, "waiting", "for a human to merge");
    return false;
  }
  const ci = await deps.pulls.ciStatus(sha);
  if (ci !== "green") {
    log(n, "waiting", `CI ${ci} on ${sha}`);
    return false;
  }
  const reason = `merged #${pr.number} at ${sha}`;
  if (dryRun) {
    log(n, "would merge", `#${pr.number} at ${sha}, CI green`);
    return false;
  }
  if (!(await attempt(log, n, "merge", `#${pr.number} at ${sha}, CI green`, () => deps.pulls.squashMerge(pr.number, sha)))) {
    return false;
  }
  // If this move fails, the next cycle sees the merged pull request and moves the ticket.
  return attempt(log, n, "move Done", reason, () => board.move(n, "Done", reason));
}

async function applyOutcome(
  deps: CycleDeps,
  stage: StageConfig,
  ticket: Ticket,
  outcome: AgentRunOutcome,
  headSha: string,
) {
  const { board, log, settings } = deps;
  const n = ticket.number;

  if (outcome.kind === "usage-limit") {
    await board.move(n, "Paused", "usage limit reached");
    log(n, "pause", "usage limit reached");
    return;
  }
  if (outcome.kind !== "result") {
    return runFailed(deps, ticket, `${outcome.kind}: ${outcome.error}`);
  }

  const r = outcome.result;
  if (r.stage !== stage.name || r.ticket !== n) {
    return runFailed(deps, ticket, `result for ${r.stage} #${r.ticket} does not match the ${stage.name} run on #${n}`);
  }
  const tr = stage.on[r.result];
  if (!tr) return runFailed(deps, ticket, `stage ${stage.name} has no rule for result ${r.result}`);

  // Rules enforced on top of the stage table: a pass needs evidence and merges
  // later; a build needs an open pull request and a diff within maxDiffLines.
  if (r.result === "pass") return acceptPass(deps, stage, ticket, headSha);
  if (tr.action === "retry") {
    log(n, "retry", `${r.result}: ${tr.log}`);
    return;
  }
  let to = tr.to;
  let reason = r.reason ? `${r.result}: ${r.reason}` : r.result;
  if (r.result === "built") {
    const tooBig = await checkBuild(deps, ticket);
    if (tooBig === undefined) return;
    if (tooBig) [to, reason] = ["Needs human", tooBig];
  }
  if (tr.countRound && ticket.round >= settings.maxRounds) {
    const reason = `round cap ${settings.maxRounds} reached`;
    await board.move(n, "Needs human", reason);
    log(n, "move Needs human", reason);
    return;
  }
  if (tr.countRound) await board.setRound(n, ticket.round + 1);
  await board.move(n, to, reason);
  log(n, `move ${to}`, reason);
}

/**
 * After `built`: the ticket needs an open pull request. Names files outside
 * "Files likely touched" in one comment. Returns the Needs human reason when the
 * diff is over maxDiffLines, "" when it may go on, or undefined after a failed run.
 */
async function checkBuild(deps: CycleDeps, ticket: Ticket): Promise<string | undefined> {
  const { board, log, settings } = deps;
  const n = ticket.number;
  const pr = await deps.pulls.forTicket(n);
  if (!pr || pr.state !== "open") {
    await runFailed(deps, ticket, `built but no open pull request on foreman/ticket-${n}`);
    return undefined;
  }
  const files = await deps.pulls.files(pr.number);
  const listed = new Set(ticket.body?.filesLikelyTouched ?? []);
  const outside = files.paths.filter((p) => !listed.has(p));
  if (outside.length) {
    const list = outside.map((p) => `- ${p}`).join("\n");
    await board.comment(n, `Files outside "Files likely touched":\n${list}`);
    log(n, "comment", `${outside.length} files outside "Files likely touched"`);
  }
  if (files.changedLines > settings.maxDiffLines) {
    return `diff of ${files.changedLines} lines exceeds maxDiffLines ${settings.maxDiffLines}`;
  }
  return "";
}

/**
 * After `pass`: every test case needs evidence in the report posted since this
 * run's claim. Records the tested sha; the merge happens in a later cycle.
 */
async function acceptPass(deps: CycleDeps, stage: StageConfig, ticket: Ticket, headSha: string): Promise<void> {
  const { board, log } = deps;
  const n = ticket.number;
  const all = await board.comments(n);
  const claimAt = all.findLastIndex((c) => {
    const e = parseComment(c);
    return e?.kind === "claim" && e.stage === stage.name;
  });
  const since = claimAt < 0 ? [] : all.slice(claimAt + 1);
  const problems = checkEvidence(ticket.body?.testCases ?? [], since);
  if (problems.length) return runFailed(deps, ticket, `pass rejected: ${problems.join("; ")}`);
  await board.recordPassed(n, headSha);
  log(n, "record pass", `tested ${headSha}, waiting to merge`);
}

async function runFailed(deps: CycleDeps, ticket: Ticket, reason: string): Promise<void> {
  const { board, log } = deps;
  await board.recordRunFailed(ticket.number, reason);
  const count = ticket.failedRuns + 1;
  log(ticket.number, "run failed", `${reason} (${count} in a row)`);
  if (count >= MAX_FAILED_RUNS) {
    const why = `${MAX_FAILED_RUNS} runs in a row without a valid result`;
    await board.move(ticket.number, "Needs human", why);
    log(ticket.number, "move Needs human", why);
  }
}

/** Runs `fn` and logs the action; on error logs the failure and returns false. */
async function attempt(
  log: CycleLog,
  n: number,
  action: string,
  reason: string,
  fn: () => Promise<void>,
): Promise<boolean> {
  try {
    await fn();
    log(n, action, reason);
    return true;
  } catch (e) {
    log(n, `${action} failed`, (e as Error).message);
    return false;
  }
}

function makeScrub(secrets: string[]): (s: string) => string {
  const list = secrets.filter((s) => s.length > 0);
  return (s) => list.reduce((acc, secret) => acc.split(secret).join("***"), s);
}

/** The board with every text argument scrubbed of secrets. */
function scrubbedBoard(board: BoardAdapter, scrub: (s: string) => string): BoardAdapter {
  return {
    create: (input) => board.create({ ...input, title: scrub(input.title), body: scrub(input.body) }),
    get: (n) => board.get(n),
    list: (f) => board.list(f),
    claim: (n, stage, by) => board.claim(n, stage, scrub(by)),
    release: (n, reason) => board.release(n, scrub(reason)),
    move: (n, to, reason) => board.move(n, to, scrub(reason)),
    setRound: (n, round) => board.setRound(n, round),
    comment: (n, body) => board.comment(n, scrub(body)),
    recordRunFailed: (n, reason) => board.recordRunFailed(n, scrub(reason)),
    recordPassed: (n, sha) => board.recordPassed(n, sha),
    comments: (n) => board.comments(n),
  };
}
