import { spawn } from "node:child_process";
import { parseResult, ResultParseError } from "../result.ts";
import { agentEnv } from "./env.ts";
import type { AgentAdapter, AgentRunInput, AgentRunOutcome } from "./types.ts";

export interface ClaudeCodeOptions {
  /** Tools the agent may use without asking, e.g. "Bash(npm test)". */
  allowedTools: string[];
  /** Env vars to keep even though they look secret (e.g. a scoped repo token). */
  keepEnv?: string[];
  timeoutMs: number;
}

/**
 * Runs one stage with `claude -p`, signed in with the Claude plan.
 * Never pass --bare: in this CLI version it forces API-key auth.
 */
export class ClaudeCodeAgent implements AgentAdapter {
  private readonly opts: ClaudeCodeOptions;
  constructor(opts: ClaudeCodeOptions) {
    this.opts = opts;
  }

  async run(input: AgentRunInput): Promise<AgentRunOutcome> {
    const prompt = [
      `Use the ${input.skill} skill.`,
      `Ticket: #${input.ticket.number} "${input.ticket.title}". Round: ${input.round}.`,
      "",
      input.ticket.rawBody,
    ].join("\n");

    const args = [
      "-p",
      "--output-format",
      "json",
      "--permission-mode",
      "default",
      "--allowedTools",
      ...this.opts.allowedTools,
    ];

    const { code, stdout, stderr } = await exec("claude", args, input.workdir, this.opts.timeoutMs, this.opts.keepEnv, prompt);
    return toOutcome(code, stdout, stderr);
  }
}

/** Turns what `claude -p --output-format json` printed into a run outcome. */
export function toOutcome(code: number | null, stdout: string, stderr: string): AgentRunOutcome {
  const transcript = stdout + (stderr ? `\n[stderr]\n${stderr}` : "");

  let text = stdout;
  try {
    const json = JSON.parse(stdout) as { result?: string; is_error?: boolean };
    text = json.result ?? "";
  } catch {
    /* not JSON: fall back to raw stdout */
  }

  // TODO(F0): confirm the exact wording Claude Code uses when a plan limit is hit.
  if (/usage limit|rate limit|limit reached/i.test(text + stderr)) {
    return { kind: "usage-limit", transcript };
  }
  if (code !== 0 && !text.includes("FOREMAN-RESULT")) {
    // Claude Code reports errors such as a failed sign-in in the JSON result, not on stderr.
    const reason = stderr.trim() || text.trim();
    return { kind: "crashed", error: `exit ${code}: ${reason.slice(0, 500)}`, transcript };
  }
  try {
    return { kind: "result", result: parseResult(text), transcript };
  } catch (e) {
    if (e instanceof ResultParseError) return { kind: "no-result", error: e.message, transcript };
    throw e;
  }
}

export function exec(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  keepEnv: string[] = [],
  stdin?: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: agentEnv(process.env, keepEnv), stdio: ["pipe", "pipe", "pipe"] });
    // Prompt goes in on stdin: no shell quoting, no command-line length limit.
    child.stdin.end(stdin ?? "");
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
