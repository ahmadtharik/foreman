// Shared vocabulary. Everything else imports from here.

export const STATUSES = [
  "Backlog",
  "Ready",
  "In progress",
  "QA",
  "Done",
  "Paused",
  "Needs human",
] as const;
export type Status = (typeof STATUSES)[number];

export const RESULTS = [
  "built",
  "blocked",
  "pass",
  "fail",
  "environment",
  "test-case-wrong",
] as const;
export type ResultKind = (typeof RESULTS)[number];

export type StageName = "build" | "review";

/** The FOREMAN-RESULT block an agent writes last. */
export interface AgentResult {
  stage: StageName;
  ticket: number;
  result: ResultKind;
  round: number;
  pullRequest?: string;
  reason?: string;
}

export interface TestCase {
  id: string;
  type: "check" | "browser";
  steps: string;
  expected: string;
}

/** A ticket body parsed from the fixed template. */
export interface TicketBody {
  summary: string;
  context: string;
  definitionOfDone: string[];
  testCases: TestCase[];
  dependencies: number[];
  filesLikelyTouched: string[];
  outOfScope: string;
}

/** A ticket as the runner sees it: body plus state stored on the board. */
export interface Ticket {
  number: number;
  title: string;
  status: Status;
  /** `null` when the body does not match the template; see `parseError`. */
  body: TicketBody | null;
  /** The parser's message when `body` is `null`. */
  parseError?: string;
  rawBody: string;
  round: number;
  claim?: Claim;
  /** Runs since the latest move that produced no valid result. */
  failedRuns: number;
  /** The commit a passing review tested, until the ticket moves again. */
  passedSha?: string;
  /** The status a Paused ticket came from. */
  pausedFrom?: Status;
}

export interface Claim {
  by: string; // runner instance id
  stage: StageName;
  at: Date;
}
