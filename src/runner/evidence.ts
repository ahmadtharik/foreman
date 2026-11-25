import type { TestCase } from "../types.ts";

const PASS_LINE = /^\s*Result:\s*PASS\s*$/m;
const NO_EVIDENCE = new Set(["", "-", "none", "n/a"]);

/** Cells of each markdown table row in `text`, trimmed, without the outer pipes. */
function tableRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith("|"))
    .map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
}

/**
 * Checks the reviewer's report (format in `.claude/skills/foreman-review/SKILL.md`).
 * Reads the latest comment with a line `Result: PASS`; every test case needs a row
 * whose result is `pass` and whose evidence is not empty, `-`, `none` or `n/a`.
 * Returns the problems; empty means OK.
 */
export function checkEvidence(testCases: TestCase[], comments: string[]): string[] {
  const report = comments.findLast((c) => PASS_LINE.test(c));
  if (report === undefined) return ["no PASS report"];

  const evidenced = new Set<string>();
  for (const [id, result, ...rest] of tableRows(report)) {
    const evidence = rest.join("|").trim();
    if (id && result?.toLowerCase() === "pass" && !NO_EVIDENCE.has(evidence.toLowerCase())) {
      evidenced.add(id);
    }
  }
  return testCases.filter((c) => !evidenced.has(c.id)).map((c) => `no evidence for test case ${c.id}`);
}
