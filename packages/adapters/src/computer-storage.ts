import type {
  AdapterContext,
  ComputerRef,
  PortableFile,
  SandboxProvider,
} from "@corvo/adapter-kit";
import { SandboxStorageFullError } from "@corvo/adapter-kit";
import { getLogger } from "@corvo/logging";
import { isSandboxStorageFullError } from "./sandbox-errors.js";

/**
 * Temporary files Rook itself leaves on a computer: screenshot scratch directories, command
 * logs and markers, and interrupted workspace archives. Nothing else is named here, so a clean-up
 * can never reach the person's files. Items younger than a few minutes may still be in use.
 */
export function managedTempCleanupCommand(): string {
  const stale = "-mmin +3";
  return [
    `find /tmp/corvo -mindepth 1 -maxdepth 1 \\( -name 'observe-*' -o -name '*.log' \\) ${stale} -exec rm -rf -- {} + 2>/dev/null`,
    `find /tmp -maxdepth 1 \\( -name 'corvo-workspace-archive-*' -o -name 'corvo-command-*' -o -name 'corvo-chrome.log' \\) ${stale} -exec rm -rf -- {} + 2>/dev/null`,
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
