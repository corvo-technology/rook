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
  "GraphiteDawnCache",
  "component_crx_cache",
  "extensions_crx_cache",
  // Crash dumps and metrics the browser only writes for its vendor.
  "Crashpad",
  "Crash Reports",
  "BrowserMetrics",
] as const;
/** Where profiles live on a cloud computer and, for a local one, directly under the home. */
const BROWSER_PROFILE_ROOTS = ['"$HOME/corvo-home/.browser-profiles"', '"$HOME/.browser-profiles"'];
/** Codex CLI session logs and logs older than this are history, not state; auth and config stay. */
export const CODEX_SESSION_RETENTION_DAYS = 7;
export const CODEX_LOG_RETENTION_DAYS = 3;
/** Rook's own screenshots, downloads and scratch files older than this are regenerable. */
export const ROOK_TEMP_RETENTION_DAYS = 1;

/** Where a cloud computer keeps the home, and, for a local one, the user home itself. */
const HOME_BASES = ["$HOME", "$HOME/corvo-home"] as const;
/**
 * Caches that tools rebuild on demand, relative to the home: package managers (npm, pnpm, pip)
 * and the browser's own cache directories. Their top-level entries are emptied; the directories
 * stay. Browser binaries (`.cache/ms-playwright`), logins, settings and workspace files are
 * not named.
 */
export const REGENERABLE_CACHE_DIRS = [
  ".npm/_cacache",
  ".npm/_logs",
  ".cache/pip",
  ".cache/pnpm",
  ".local/share/pnpm/store",
  ".cache/chromium",
  ".cache/google-chrome",
  ".config/chromium/Crash Reports",
  ".config/google-chrome/Crash Reports",
] as const;
/** Scratch the browser and Playwright leave directly under /tmp, plus core dumps. */
const TMP_SCRATCH_NAMES = [
  "corvo-workspace-archive-*",
  "corvo-command-*",
  "corvo-chrome.log",
  "playwright_chromiumdev_profile-*",
  "playwright-artifacts-*",
  ".org.chromium.*",
  ".com.google.Chrome.*",
] as const;
/** Core dumps a crashed process leaves in the home or /tmp; only plain files by these names. */
const CORE_DUMP_NAMES = ["core", "core.[0-9]*"] as const;

/**
 * Files Rook itself leaves on a computer, or that the browser, package managers and Codex CLI
 * rebuild or age out: screenshot scratch directories, command logs and markers, interrupted
 * workspace archives, Rook's temp older than a day, browser caches and crash dumps, npm, pnpm and
 * pip caches, core dumps, and old Codex sessions and logs. Nothing else is named here, so a
 * clean-up can never reach the person's files, logins or settings. Items younger than a few
 * minutes may still be in use.
 */
export function managedTempCleanupCommand(): string {
  const stale = "-mmin +3";
  const cacheNames = PRUNED_BROWSER_CACHE_NAMES.map((name) => `-name '${name}'`).join(" -o ");
  const tmpNames = TMP_SCRATCH_NAMES.map((name) => `-name '${name}'`).join(" -o ");
  const coreNames = CORE_DUMP_NAMES.map((name) => `-name '${name}'`).join(" -o ");
  return [
    `find /tmp/corvo -mindepth 1 -maxdepth 1 \\( -name 'observe-*' -o -name '*.log' \\) ${stale} -exec rm -rf -- {} + 2>/dev/null`,
    `find /tmp/corvo -mindepth 1 -maxdepth 1 -mtime +${ROOK_TEMP_RETENTION_DAYS} -exec rm -rf -- {} + 2>/dev/null`,
    `find /tmp -maxdepth 1 \\( ${tmpNames} \\) ${stale} -exec rm -rf -- {} + 2>/dev/null`,
    ...BROWSER_PROFILE_ROOTS.flatMap((root) => [
      `find ${root} -mindepth 2 -maxdepth 4 -type d \\( ${cacheNames} \\) ${stale} -prune -exec rm -rf -- {} + 2>/dev/null`,
      `find ${root} -mindepth 3 -maxdepth 4 -type d -name 'CacheStorage' -path '*/Service Worker/CacheStorage' ${stale} -prune -exec rm -rf -- {} + 2>/dev/null`,
    ]),
    ...HOME_BASES.flatMap((base) =>
      REGENERABLE_CACHE_DIRS.map(
        (dir) =>
          `find "${base}/${dir}" -mindepth 1 -maxdepth 1 ${stale} -exec rm -rf -- {} + 2>/dev/null`,
      ),
    ),
    ...["/tmp", '"$HOME"', '"$HOME/corvo-home"'].map(
      (dir) => `find ${dir} -maxdepth 1 -type f \\( ${coreNames} \\) ${stale} -delete 2>/dev/null`,
    ),
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

const MB = 1024 * 1024;
/** Below this much free space (or 15% of the disk, if more) the owner is warned before it is full. */
export const WARN_FREE_BYTES = 3 * 1024 * MB;
const WARN_FREE_FRACTION = 0.15;

/** Whether the disk is close enough to full that its owner should hear of it. */
export function isStorageLow(disk: { free: number; total: number }): boolean {
  return disk.free < Math.max(WARN_FREE_BYTES, disk.total * WARN_FREE_FRACTION);
}

export type StorageLow = {
  freeBytes: number;
  usedBytes: number;
  totalBytes: number;
  /** The largest directories, e.g. ".codex 475 MB, .nvm 229 MB". */
  usage?: string;
};

/** Disk numbers as structured log fields; names only, never file contents. */
function diskFields(disk: { free: number; used: number; total: number }, usage?: string) {
  return {
    "disk.free_mb": Math.floor(disk.free / MB),
    "disk.used_mb": Math.floor(disk.used / MB),
    "disk.total_mb": Math.floor(disk.total / MB),
    ...(usage ? { "disk.largest": usage } : {}),
  };
}

/**
 * Checks the computer's free space before a run or browser starts. Below the threshold Rook's
 * managed clean-up runs first; if that is not enough, the start fails here with the full-computer
 * error and the largest directories, instead of failing partway. An unreadable disk never blocks.
 * Returns what to warn about when there is room now but not much: the caller tells the owner.
 */
export async function ensureFreeSpace(
  sandbox: Pick<SandboxProvider, "execute">,
  computer: ComputerRef,
  context: AdapterContext,
  minFree = MIN_FREE_BYTES,
): Promise<{ low?: StorageLow }> {
  const before = await diskBytes(sandbox, computer, context);
  if (before === undefined) return {};
  let disk = before;
  if (before.free < minFree || isStorageLow(before)) {
    await freeManagedTemp(sandbox, computer, context);
    disk = (await diskBytes(sandbox, computer, context)) ?? before;
    getLogger().info("computer.storage.cleaned", {
      ...diskFields(disk),
      "disk.freed_mb": Math.max(0, Math.floor((disk.free - before.free) / MB)),
    });
  }
  if (disk.free < minFree) {
    const usage = await describeLargestDirectories(sandbox, computer, context);
    getLogger().error("computer.storage.full", diskFields(disk, usage));
    throw new SandboxStorageFullError({
      cause: new Error(`only ${Math.floor(disk.free / MB)} MB free`),
      usage,
      disk: { usedBytes: disk.used, totalBytes: disk.total },
    });
  }
  if (!isStorageLow(disk)) return {};
  const usage = await describeLargestDirectories(sandbox, computer, context);
  getLogger().warn("computer.storage.low", diskFields(disk, usage));
  return {
    low: { freeBytes: disk.free, usedBytes: disk.used, totalBytes: disk.total, usage },
  };
}

/**
 * Clears Rook's stale temporary files on request and reports the room that opened up, so a
 * person can free a full computer without waiting for the next start to do it. `freeBytes` is
 * what is free afterwards, for clearing the back-off once there is room to start again.
 */
export async function freeComputerSpace(
  sandbox: Pick<SandboxProvider, "execute">,
  computer: ComputerRef,
  context: AdapterContext,
): Promise<{ freedBytes: number | null; freeBytes: number | null }> {
  const before = await freeBytes(sandbox, computer, context);
  await freeManagedTemp(sandbox, computer, context);
  const after = await freeBytes(sandbox, computer, context);
  const freedBytes =
    before === undefined || after === undefined ? null : Math.max(0, after - before);
  getLogger().info("computer.storage.freed", {
    "disk.freed_mb": freedBytes === null ? null : Math.floor(freedBytes / MB),
  });
  return { freedBytes, freeBytes: after ?? null };
}
