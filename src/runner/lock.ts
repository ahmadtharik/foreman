import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

export interface Lock {
  release(): void;
}

/** True if a process with this pid exists. EPERM means it exists but is not ours. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function create(path: string): boolean {
  try {
    writeFileSync(path, String(process.pid), { flag: "wx" });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
}

/**
 * Takes the lock file at `path` so only one runner runs. A lock left by a
 * process that is no longer alive is taken over.
 */
export function acquireLock(path: string): Lock {
  if (!create(path)) {
    const held = readFileSync(path, "utf8").trim();
    const pid = Number(held);
    if (Number.isInteger(pid) && pid > 0 && alive(pid)) {
      throw new Error(`Another runner is already running (pid ${pid}). Lock file: ${path}`);
    }
    console.warn(`Taking over lock ${path} left by pid ${held || "unknown"}, which is not running.`);
    unlinkSync(path);
    if (!create(path)) throw new Error(`Another runner took the lock first. Lock file: ${path}`);
  }
  const mine = String(process.pid);
  return {
    release() {
      try {
        if (readFileSync(path, "utf8").trim() === mine) unlinkSync(path);
      } catch {
        /* already gone */
      }
    },
  };
}
