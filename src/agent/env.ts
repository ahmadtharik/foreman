/**
 * Environment for agent runs. Cost rule: runs must bill to the Claude plan,
 * so any API key is removed. Secrets the agent does not need are removed too.
 */
const STRIP = [/^ANTHROPIC_API_KEY$/, /^ANTHROPIC_AUTH_TOKEN$/, /^CLAUDE_CODE_SIMPLE$/, /TOKEN$/, /SECRET/, /PASSWORD/];

export function agentEnv(base: NodeJS.ProcessEnv = process.env, keep: string[] = []): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (keep.includes(k) || !STRIP.some((re) => re.test(k))) env[k] = v;
  }
  return env;
}
