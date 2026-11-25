import type { AgentAdapter, AgentRunOutcome } from "../agent/types.ts";
import type { BoardAdapter } from "../board/types.ts";
import type { Settings, StageConfig } from "../config.ts";
import type { StageName, Status, Ticket } from "../types.ts";
import type { Worktrees } from "./worktree.ts";

/** One line per action: the ticket (or null), the action, and why. */
export type CycleLog = (ticket: number | null, action: string, reason: string) => void;

export interface CycleDeps {
  board: BoardAdapter;
  agents: Record<StageName, AgentAdapter>;
  worktrees: Worktrees;
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
 * release stale claims, then pick and run at most one ticket per stage.
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

  // 4. Pick the lowest-numbered eligible ticket per stage.
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

  // 5. Run the picks; stages run at the same time.
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
    try {
      const wt = await deps.worktrees.prepare(n, stage.name);
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
    await applyOutcome(deps, stage, ticket, outcome);
  } catch (e) {
    log(n, "error", (e as Error).message);
  } finally {
    await attempt(log, n, "release", `${stage.name} run finished`, () => board.release(n, `${stage.name} run finished`));
  }
}

async function applyOutcome(deps: CycleDeps, stage: StageConfig, ticket: Ticket, outcome: AgentRunOutcome) {
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

  if (tr.action === "retry") {
    log(n, "retry", `${r.result}: ${tr.log}`);
    return;
  }
  if (tr.countRound && ticket.round >= settings.maxRounds) {
    const reason = `round cap ${settings.maxRounds} reached`;
    await board.move(n, "Needs human", reason);
    log(n, "move Needs human", reason);
    return;
  }
  if (tr.countRound) await board.setRound(n, ticket.round + 1);
  const reason = r.reason ? `${r.result}: ${r.reason}` : r.result;
  await board.move(n, tr.to, reason);
  log(n, `move ${tr.to}`, reason);
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
