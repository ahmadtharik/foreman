import type { Status } from "../types.ts";

/** Ticket status is stored as exactly one of these labels. */
export const STATUS_LABELS: Record<Status, { name: string; color: string; description: string }> = {
  Backlog: { name: "status: backlog", color: "d4d4d8", description: "Planned, not yet released to agents" },
  Ready: { name: "status: ready", color: "0ea5e9", description: "Dependencies done, waiting for a builder" },
  "In progress": { name: "status: in progress", color: "f59e0b", description: "Being built, or returned from QA" },
  QA: { name: "status: qa", color: "8b5cf6", description: "Built, waiting for review" },
  Done: { name: "status: done", color: "22c55e", description: "Passed review" },
  Paused: { name: "status: paused", color: "64748b", description: "Stopped by plan usage limit, resumes later" },
  "Needs human": { name: "status: needs human", color: "ef4444", description: "Blocked, wrong test case, or round cap hit" },
};

export const CLAIM_LABEL = { name: "foreman: claimed", color: "111827", description: "A runner is working on this ticket" };

export function statusFromLabels(labels: string[]): Status | undefined {
  const found = (Object.keys(STATUS_LABELS) as Status[]).filter((s) => labels.includes(STATUS_LABELS[s].name));
  return found.length === 1 ? found[0] : undefined;
}
