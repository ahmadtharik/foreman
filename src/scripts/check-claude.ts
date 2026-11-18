// F0 check: a non-interactive Claude Code run works while signed in with the plan,
// with no API key in the environment. Uses a tiny prompt, no tools.
import { exec } from "../agent/claude-code.ts";

if (process.env.ANTHROPIC_API_KEY) {
  console.log("Note: ANTHROPIC_API_KEY is set in your shell. Foreman strips it from agent runs.");
}

const { code, stdout, stderr } = await exec(
  "claude",
  ["-p", "--output-format", "json", "--tools", ""],
  process.cwd(),
  120_000,
  [],
  "Reply with exactly: FOREMAN-OK",
);

let json: Record<string, unknown> = {};
try {
  json = JSON.parse(stdout);
} catch {
  console.error("Output was not JSON:\n", stdout, stderr);
  process.exit(1);
}

const ok = code === 0 && String(json.result ?? "").includes("FOREMAN-OK") && !json.is_error;
console.log(JSON.stringify({ ok, exit: code, result: json.result, total_cost_usd: json.total_cost_usd }, null, 2));
if (!ok) {
  console.error(stderr);
  process.exit(1);
}
