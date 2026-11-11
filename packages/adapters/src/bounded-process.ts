import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";

const DEFAULT_GRACE_MS = 1_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

/** Stops a child and everything it started, which share its process group off Windows. */
export function killProcessTree(child: ChildProcess): void {
  try {
    if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

export type BoundedResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

/**
 * Runs a program with an argument array and no shell. At `timeoutMs` the whole process group is
 * killed, and the call settles at `timeoutMs + graceMs` even when a grandchild still holds the pipes.
 */
export function runBounded(
  file: string,
  args: readonly string[],
  options: {
    timeoutMs: number;
    env?: NodeJS.ProcessEnv;
    graceMs?: number;
    maxOutputBytes?: number;
  },
): Promise<BoundedResult> {
  const limit = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let code: number | null = null;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      clearTimeout(graceTimer);
      resolve({ code, stdout, stderr, timedOut });
    };
    let child: ChildProcess;
    try {
      child = spawn(file, [...args], {
        env: options.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      });
    } catch {
      resolve({ code: null, stdout, stderr, timedOut });
      return;
    }
    const killTimer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, options.timeoutMs);
    const graceTimer = setTimeout(
      finish,
      options.timeoutMs + (options.graceMs ?? DEFAULT_GRACE_MS),
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < limit) stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < limit) stderr += chunk.toString("utf8");
    });
    child.once("error", finish);
    child.once("close", (exitCode) => {
      code = exitCode;
      finish();
    });
  });
}
