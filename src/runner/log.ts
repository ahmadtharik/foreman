import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { CycleLog } from "./cycle.ts";

export interface LogOptions {
  /** Directory for `runner-<YYYY-MM-DD>.log` files. */
  dir: string;
  /** Strings replaced by `***` in every line. */
  secrets: string[];
  now?: () => Date;
}

/** Writes `<ISO time> #<n> <action>: <reason>` to stdout and the day's log file. */
export function createLog(opts: LogOptions): CycleLog {
  const now = opts.now ?? (() => new Date());
  const secrets = opts.secrets.filter((s) => s.length > 0);
  const scrub = (s: string) => secrets.reduce((acc, secret) => acc.split(secret).join("***"), s);
  mkdirSync(opts.dir, { recursive: true });
  return (ticket, action, reason) => {
    const time = now().toISOString();
    const line = scrub(`${time} ${ticket === null ? "-" : `#${ticket}`} ${action}: ${reason}`);
    console.log(line);
    appendFileSync(path.join(opts.dir, `runner-${time.slice(0, 10)}.log`), line + "\n");
  };
}
