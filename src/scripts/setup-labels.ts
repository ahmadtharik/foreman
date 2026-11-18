// Creates or updates Foreman's labels on a repo. Safe to run again.
// Usage: node src/scripts/setup-labels.ts owner/name
import { CLAIM_LABEL, STATUS_LABELS } from "../board/labels.ts";

const repo = process.argv[2];
const token = process.env.FOREMAN_GITHUB_TOKEN;
if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("usage: setup-labels.ts owner/name");
if (!token) throw new Error("FOREMAN_GITHUB_TOKEN is not set");

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "foreman",
};

for (const label of [...Object.values(STATUS_LABELS), CLAIM_LABEL]) {
  const url = `https://api.github.com/repos/${repo}/labels/${encodeURIComponent(label.name)}`;
  const exists = (await fetch(url, { headers })).ok;
  const res = exists
    ? await fetch(url, { method: "PATCH", headers, body: JSON.stringify({ color: label.color, description: label.description }) })
    : await fetch(`https://api.github.com/repos/${repo}/labels`, { method: "POST", headers, body: JSON.stringify(label) });
  if (!res.ok) throw new Error(`${label.name}: ${res.status} ${await res.text()}`);
  console.log(`${exists ? "updated" : "created"}  ${label.name}`);
}
