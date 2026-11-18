import type {
  AdapterContext,
  ComputerRef,
  PortableFile,
  SandboxProvider,
} from "@corvo/adapter-kit";
import { SandboxStorageFullError } from "@corvo/adapter-kit";
import { getLogger } from "@corvo/logging";
import { isSandboxStorageFullError } from "./sandbox-errors.js";

/** Browser caches that Chromium rebuilds on demand. Cookies, logins and history are not named. */
export const PRUNED_BROWSER_CACHE_NAMES = [
  "Cache",
  "Code Cache",
  "GPUCache",
  "GrShaderCache",
  "ShaderCache",
  "DawnCache",
] as const;
/** Where profiles live on a cloud computer and, for a local one, directly under the home. */
const BROWSER_PROFILE_ROOTS = ['"$HOME/corvo-home/.browser-profiles"', '"$HOME/.browser-profiles"'];
/** Codex CLI session logs and logs older than this are history, not state; auth and config stay. */
export const CODEX_SESSION_RETENTION_DAYS = 7;
export const CODEX_LOG_RETENTION_DAYS = 3;

/**
 * Files Rook itself leaves on a computer, or that the browser and Codex CLI rebuild or age out:
 * screenshot scratch directories, command logs and markers, interrupted workspace archives,
 * stale browser caches, and old Codex sessions and logs. Nothing else is named here, so a
 * clean-up can never reach the person's files, logins or settings. Items younger than a few
 * minutes may still be in use.
 */
export function managedTempCleanupCommand(): string {
  const stale = "-mmin +3";
  const cacheNames = PRUNED_BROWSER_CACHE_NAMES.map((name) => `-name '${name}'`).join(" -o ");
  return [
    `find /tmp/corvo -mindepth 1 -maxdepth 1 \\( -name 'observe-*' -o -name '*.log' \\) ${stale} -exec rm -rf -- {} + 2>/dev/null`,
    `find /tmp -maxdepth 1 \\( -name 'corvo-workspace-archive-*' -o -name 'corvo-command-*' -o -name 'corvo-chrome.log' \\) ${stale} -exec rm -rf -- {} + 2>/dev/null`,
    ...BROWSER_PROFILE_ROOTS.flatMap((root) => [
      `find ${root} -mindepth 2 -maxdepth 4 -type d \\( ${cacheNames} \\) ${stale} -prune -exec rm -rf -- {} + 2>/dev/null`,
      `find ${root} -mindepth 3 -maxdepth 4 -type d -name 'CacheStorage' -path '*/Service Worker/CacheStorage' ${stale} -prune -exec rm -rf -- {} + 2>/dev/null`,
    ]),
    `find "$HOME/.codex/sessions" -type f -mtime +${CODEX_SESSION_RETENTION_DAYS} -delete 2>/dev/null`,
    `find "$HOME/.codex/log" -type f -mtime +${CODEX_LOG_RETENTION_DAYS} -delete 2>/dev/null`,
    "true",
  ].join("; ");
}

/** Clears Rook's stale temporary files on the computer. It never throws. */
export async function freeManagedTemp(
  sandbox: Pick<SandboxProvider, "execute">,
  computer: ComputerRef,
  context: AdapterContext,
): Promise<void> {
  try {
    for await (const event of sandbox.execute(
      computer,
      { argv: ["sh", "-c", managedTempCleanupCommand()], timeoutMs: 30_000 },
      context,
    )) {
      void event;
    }
  } catch (error) {
    if (context.signal.aborted) return;
    getLogger().warn("computer temp clean-up failed", { error });
  }
}

/**
 * Writes a file to the computer. When it has no room, Rook's stale temporary files are cleared
 * and the write is tried once more. A write that still fails is reported as a full computer, so
 * it is never taken for done, and the write's own partial file is removed.
 */
export async function writeFileWithRoom(
  sandbox: Pick<SandboxProvider, "execute" | "writeFile">,
  computer: ComputerRef,
  file: PortableFile,
  context: AdapterContext,
): Promise<void> {
  try {
    await sandbox.writeFile(computer, file, context);
    return;
  } catch (error) {
    if (!isSandboxStorageFullError(error)) throw error;
  }
  await freeManagedTemp(sandbox, computer, context);
  try {
    await sandbox.writeFile(computer, file, context);
  } catch (error) {
    if (!isSandboxStorageFullError(error)) throw error;
    // A partial copy would later be read as the whole file.
    await removeFile(sandbox, computer, file.path, context);
    throw new SandboxStorageFullError({ cause: error });
  }
}

async function removeFile(
  sandbox: Pick<SandboxProvider, "execute">,
  computer: ComputerRef,
  path: string,
  context: AdapterContext,
): Promise<void> {
  try {
    for await (const event of sandbox.execute(
      computer,
      { argv: ["rm", "-f", "--", path], timeoutMs: 15_000 },
      context,
    )) {
      void event;
    }
  } catch {
    // Best effort: the failure being reported is the full computer.
  }
}

/** A run or browser start needs at least this much free space on the computer's disk. */
export const MIN_FREE_BYTES = 300 * 1024 * 1024;
const TOP_DIRECTORIES = 4;

async function runCapture(
  sandbox: Pick<SandboxProvider, "execute">,
  computer: ComputerRef,
  script: string,
  context: AdapterContext,
): Promise<string> {
  let out = "";
  for await (const event of sandbox.execute(
    computer,
    { argv: ["sh", "-c", script], timeoutMs: 30_000 },
    context,
  )) {
    if (event.type === "stdout") out += event.data;
  }
  return out;
}

async function diskBytes(
  sandbox: Pick<SandboxProvider, "execute">,
  computer: ComputerRef,
  context: AdapterContext,
): Promise<{ free: number; used: number; total: number } | undefined> {
  try {
    const out = await runCapture(sandbox, computer, 'df -Pk "$HOME" | tail -n 1', context);
    const [, total, used, free] = out.trim().split(/\s+/).map(Number);
    if (total === undefined || used === undefined || free === undefined) return undefined;
    return [total, used, free].every(Number.isFinite)
      ? { total: total * 1024, used: used * 1024, free: free * 1024 }
      : undefined;
  } catch {
    return undefined;
  }
}

async function freeBytes(
  sandbox: Pick<SandboxProvider, "execute">,
  computer: ComputerRef,
  context: AdapterContext,
): Promise<number | undefined> {
  return (await diskBytes(sandbox, computer, context))?.free;
}

/** The largest directories under the home, e.g. ".codex 475 MB, .nvm 229 MB", for the owner. */
export async function describeLargestDirectories(
  sandbox: Pick<SandboxProvider, "execute">,
  computer: ComputerRef,
  context: AdapterContext,
): Promise<string | undefined> {
  try {
    const out = await runCapture(
      sandbox,
      computer,
      `cd "$HOME" 2>/dev/null && du -xk -d 2 . 2>/dev/null | sort -rn | sed -n '2,${TOP_DIRECTORIES + 1}p'`,
      context,
    );
    const rows = out
      .split("\n")
      .map((line) => line.trim().match(/^(\d+)\s+(?:\.\/)?(.+)$/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => `${match[2]} ${Math.max(1, Math.round(Number(match[1]) / 1024))} MB`);
    return rows.length ? rows.join(", ") : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Checks the computer's free space before a run or browser starts. Below the threshold Rook's
 * managed clean-up runs first; if that is not enough, the start fails here with the full-computer
 * error and the largest directories, instead of failing partway. An unreadable disk never blocks.
 */
export async function ensureFreeSpace(
  sandbox: Pick<SandboxProvider, "execute">,
  computer: ComputerRef,
  context: AdapterContext,
  minFree = MIN_FREE_BYTES,
): Promise<void> {
  const before = await freeBytes(sandbox, computer, context);
  if (before === undefined || before >= minFree) return;
  await freeManagedTemp(sandbox, computer, context);
  const after = await diskBytes(sandbox, computer, context);
  if (after === undefined || after.free >= minFree) return;
  throw new SandboxStorageFullError({
    cause: new Error(`only ${Math.floor(after.free / 1024 / 1024)} MB free`),
    usage: await describeLargestDirectories(sandbox, computer, context),
    disk: { usedBytes: after.used, totalBytes: after.total },
  });
}

/**
 * Clears Rook's stale temporary files on request and reports the room that opened up, so a
 * person can free a full computer without waiting for the next start to do it.
 */
export async function freeComputerSpace(
  sandbox: Pick<SandboxProvider, "execute">,
  computer: ComputerRef,
  context: AdapterContext,
): Promise<{ freedBytes: number | null }> {
  const before = await freeBytes(sandbox, computer, context);
  await freeManagedTemp(sandbox, computer, context);
  const after = await freeBytes(sandbox, computer, context);
  return {
    freedBytes: before === undefined || after === undefined ? null : Math.max(0, after - before),
  };
}
