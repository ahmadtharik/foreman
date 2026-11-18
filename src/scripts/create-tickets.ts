// Creates the tickets of an approved plan as GitHub issues, in order, with status Backlog.
// Usage: node src/scripts/create-tickets.ts owner/name plans/001.json
//
// Plan file: [{ "title": "...", "body": "<ticket template>" }, ...] in dependency order.
// A body may refer to an earlier ticket in the same plan as T1, T2, ... (e.g. "- #T1").
// Each placeholder is replaced with the real issue number once that ticket exists.
import { readFileSync } from "node:fs";
import { STATUS_LABELS } from "../board/labels.ts";
import { lintTicket, parseTicket } from "../ticket.ts";

const [repo, planPath] = process.argv.slice(2);
const token = process.env.FOREMAN_GITHUB_TOKEN;
if (!repo || !planPath) throw new Error("usage: create-tickets.ts owner/name plan.json");
if (!token) throw new Error("FOREMAN_GITHUB_TOKEN is not set");

const plan = JSON.parse(readFileSync(planPath, "utf8")) as { title: string; body: string }[];

// Validate everything before creating anything.
const problems = plan.flatMap((t, i) => {
  try {
    return lintTicket(parseTicket(t.body)).map((p) => `T${i + 1}: ${p}`);
  } catch (e) {
    return [`T${i + 1}: ${(e as Error).message}`];
  }
});
if (problems.length) {
  console.error("Plan not created:\n- " + problems.join("\n- "));
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "foreman",
};

const numbers: number[] = [];
for (const [i, t] of plan.entries()) {
  const body = t.body.replace(/#T(\d+)\b/g, (m, n) => {
    const real = numbers[Number(n) - 1];
    if (!real) throw new Error(`T${i + 1} refers to ${m}, which is not an earlier ticket`);
    return `#${real}`;
  });
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title: t.title, body, labels: [STATUS_LABELS.Backlog.name] }),
  });
  if (!res.ok) throw new Error(`T${i + 1}: ${res.status} ${await res.text()}`);
  const issue = (await res.json()) as { number: number; html_url: string };
  numbers.push(issue.number);
  console.log(`T${i + 1} -> #${issue.number}  ${issue.html_url}`);
}
