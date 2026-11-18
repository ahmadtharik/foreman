import type { TestCase, TicketBody } from "./types.ts";

export const REQUIRED_HEADINGS = [
  "Summary",
  "Context",
  "Definition of done",
  "Test cases",
  "Dependencies",
  "Files likely touched",
  "Out of scope",
] as const;

export class TicketParseError extends Error {}

/** Split markdown into "## Heading" sections. */
function sections(md: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | null = null;
  let buf: string[] = [];
  for (const line of md.split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      if (current) out.set(current, buf.join("\n").trim());
      current = h[1]!;
      buf = [];
    } else if (current) {
      buf.push(line);
    }
  }
  if (current) out.set(current, buf.join("\n").trim());
  return out;
}

function bullets(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => /^\s*-\s*(?:\[[ xX]\]\s*)?(.*)$/.exec(l)?.[1]?.trim())
    .filter((l): l is string => !!l);
}

function testCases(text: string): TestCase[] {
  const rows = text
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith("|"))
    .map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
  const cases: TestCase[] = [];
  for (const [id, type, steps, expected] of rows) {
    if (!id || id === "#" || /^-+$/.test(id)) continue; // header and separator
    if (type !== "check" && type !== "browser") {
      throw new TicketParseError(`test case ${id}: type must be check or browser, got "${type}"`);
    }
    cases.push({ id, type, steps: steps ?? "", expected: expected ?? "" });
  }
  return cases;
}

export function parseTicket(md: string): TicketBody {
  const s = sections(md);
  const missing = REQUIRED_HEADINGS.filter((h) => !s.has(h));
  if (missing.length) throw new TicketParseError(`missing headings: ${missing.join(", ")}`);
  const get = (h: (typeof REQUIRED_HEADINGS)[number]) => s.get(h)!;

  const deps = get("Dependencies");
  const files = bullets(get("Files likely touched")).map((f) => f.replace(/`/g, ""));

  return {
    summary: get("Summary"),
    context: get("Context"),
    definitionOfDone: bullets(get("Definition of done")),
    testCases: testCases(get("Test cases")),
    dependencies: [...deps.matchAll(/#(\d+)/g)].map((m) => Number(m[1])),
    filesLikelyTouched: files,
    outOfScope: get("Out of scope"),
  };
}

/** Problems the planner's self-check should have caught. Empty array means OK. */
export function lintTicket(t: TicketBody): string[] {
  const problems: string[] = [];
  if (!t.outOfScope.trim()) problems.push("Out of scope is empty");
  if (t.definitionOfDone.length === 0) problems.push("Definition of done is empty");
  if (t.testCases.length === 0) problems.push("No test cases");
  if (t.testCases.length < t.definitionOfDone.length) {
    problems.push("Fewer test cases than definition-of-done lines");
  }
  for (const c of t.testCases) {
    if (/\b(correctly|properly|as expected)\b/i.test(c.expected)) {
      problems.push(`Test case ${c.id}: vague expected result`);
    }
  }
  return problems;
}
