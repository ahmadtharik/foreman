import { RESULTS, type AgentResult, type ResultKind, type StageName } from "./types.ts";

const ALLOWED: Record<StageName, ResultKind[]> = {
  build: ["built", "blocked"],
  review: ["pass", "fail", "environment", "test-case-wrong"],
};
const NEEDS_REASON: ResultKind[] = ["blocked", "fail", "environment", "test-case-wrong"];

export class ResultParseError extends Error {}

/**
 * Parse the last FOREMAN-RESULT block in an agent's output.
 * Throws ResultParseError if it is missing or malformed. The runner treats
 * that as "no result", never as a guess.
 */
export function parseResult(output: string): AgentResult {
  const idx = output.lastIndexOf("FOREMAN-RESULT");
  if (idx === -1) throw new ResultParseError("no FOREMAN-RESULT block");

  const fields = new Map<string, string>();
  for (const raw of output.slice(idx).split(/\r?\n/).slice(1)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("```")) {
      if (fields.size > 0) break;
      continue;
    }
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!m) break;
    fields.set(m[1]!, m[2]!.trim());
  }

  const stage = fields.get("stage");
  if (stage !== "build" && stage !== "review") throw new ResultParseError(`bad stage: ${stage}`);

  const result = fields.get("result") as ResultKind | undefined;
  if (!result || !RESULTS.includes(result)) throw new ResultParseError(`bad result: ${result}`);
  if (!ALLOWED[stage].includes(result)) {
    throw new ResultParseError(`result "${result}" is not allowed for stage "${stage}"`);
  }

  const ticket = Number((fields.get("ticket") ?? "").replace(/^#/, ""));
  if (!Number.isInteger(ticket) || ticket <= 0) throw new ResultParseError("bad ticket number");

  const round = Number(fields.get("round") ?? "");
  if (!Number.isInteger(round) || round < 1) throw new ResultParseError("bad round");

  const reason = emptyToUndefined(fields.get("reason"));
  if (NEEDS_REASON.includes(result) && !reason) {
    throw new ResultParseError(`result "${result}" requires a reason`);
  }

  return { stage, ticket, result, round, pullRequest: emptyToUndefined(fields.get("pull_request")), reason };
}

function emptyToUndefined(v: string | undefined): string | undefined {
  if (!v) return undefined;
  if (/^(none|n\/a|-|<.*>)$/i.test(v)) return undefined;
  return v;
}
