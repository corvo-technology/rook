import type { AdapterContext, ComputerRef, ProcessEvent } from "@corvo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import {
  ensureFreeSpace,
  freeManagedTemp,
  MIN_FREE_BYTES,
  managedTempCleanupCommand,
  PRUNED_BROWSER_CACHE_NAMES,
  writeFileWithRoom,
} from "./computer-storage.js";
import { isSandboxStorageFullError } from "./sandbox-errors.js";

const computer = { id: "c", botId: "b", kind: "docker", providerRef: "c" } as ComputerRef;
const context = { signal: new AbortController().signal } as AdapterContext;
const file = { path: "attachments/a.png", content: new Uint8Array([1, 2, 3]) };

function sandbox(writes: Array<Error | undefined>) {
  const commands: string[][] = [];
  return {
    commands,
    execute: vi.fn(async function* (_c: ComputerRef, request: { argv: string[] }) {
      commands.push(request.argv);
      yield { type: "exit", code: 0 } satisfies ProcessEvent;
    }),
    writeFile: vi.fn(async () => {
      const next = writes.shift();
      if (next) throw next;
    }),
  };
}

describe("managedTempCleanupCommand", () => {
  it("only names Rook's own temporary paths", () => {
    const command = managedTempCleanupCommand();
    const roots = [...command.matchAll(/find (\S+)/g)].map((match) => match[1]);
    expect(new Set(roots)).toEqual(
      new Set([
        "/tmp/corvo",
        "/tmp",
        '"$HOME/corvo-home/.browser-profiles"',
        '"$HOME/.browser-profiles"',
        '"$HOME/.codex/sessions"',
        '"$HOME/.codex/log"',
      ]),
    );
    const allowed = new Set([
      "observe-*",
      "*.log",
      "corvo-workspace-archive-*",
      "corvo-command-*",
      "corvo-chrome.log",
      "CacheStorage",
      ...PRUNED_BROWSER_CACHE_NAMES,
    ]);
    for (const name of command.matchAll(/-name '([^']+)'/g)) expect(allowed).toContain(name[1]);
    expect(command).not.toMatch(
      /Cookies|Login Data|Local Storage|IndexedDB|Preferences|auth\.json|config\.toml|attachments/,
    );
  });

  it("prunes only stale Codex sessions and logs, never auth or config", () => {
    const command = managedTempCleanupCommand();
    expect(command).toContain('find "$HOME/.codex/sessions" -type f -mtime +7 -delete');
    expect(command).toContain('find "$HOME/.codex/log" -type f -mtime +3 -delete');
    expect(command).not.toMatch(/\.codex\/(?!sessions|log)/);
  });

  it("removes only directories inside browser profiles", () => {
    const lines = managedTempCleanupCommand()
      .split("; ")
      .filter((line) => line.includes("rm -rf") && line.includes("browser-profiles"));
    expect(lines.length).toBe(4);
    for (const line of lines) expect(line).toMatch(/-type d/);
  });

  it("runs as one fixed shell command", async () => {
    const box = sandbox([]);
    await freeManagedTemp(box as never, computer, context);
    expect(box.commands).toEqual([["sh", "-c", managedTempCleanupCommand()]]);
  });
});

describe("writeFileWithRoom", () => {
  it("writes once when there is room", async () => {
    const box = sandbox([]);
    await writeFileWithRoom(box as never, computer, file, context);
    expect(box.writeFile).toHaveBeenCalledTimes(1);
    expect(box.commands).toEqual([]);
  });

  it("clears temporary files and tries again when the computer is full", async () => {
    const box = sandbox([new Error("Sandbox storage is full")]);
    await writeFileWithRoom(box as never, computer, file, context);
    expect(box.writeFile).toHaveBeenCalledTimes(2);
    expect(box.commands).toEqual([["sh", "-c", managedTempCleanupCommand()]]);
  });

  it("fails loudly and removes the partial file when it is still full", async () => {
    const full = new Error("No space left on device");
    const box = sandbox([full, full]);
    const failure = await writeFileWithRoom(box as never, computer, file, context).catch(
      (error) => error,
    );
    expect(failure).toMatchObject({ code: "SANDBOX_STORAGE_FULL" });
    expect(isSandboxStorageFullError(failure)).toBe(true);
    expect(box.commands.at(-1)).toEqual(["rm", "-f", "--", "attachments/a.png"]);
  });

  it("passes other write errors through without clearing anything", async () => {
    const box = sandbox([new Error("permission denied")]);
    await expect(writeFileWithRoom(box as never, computer, file, context)).rejects.toThrow(
      "permission denied",
    );
    expect(box.commands).toEqual([]);
  });
});

describe("ensureFreeSpace", () => {
  const MB = 1024 * 1024;
  function disk(freeMb: number[], listing = "") {
    const commands: string[] = [];
    return {
      commands,
      execute: vi.fn(async function* (_c: ComputerRef, request: { argv: string[] }) {
        const script = request.argv[2] ?? "";
        commands.push(script);
        if (script.startsWith("df")) {
          const free = freeMb.length > 1 ? freeMb.shift() : freeMb[0];
          yield {
            type: "stdout",
            data: `/dev/vda 2560000 1 ${(free ?? 0) * 1024} 99% /\n`,
          } satisfies ProcessEvent;
        } else if (script.includes("du -xk")) {
          yield { type: "stdout", data: listing } satisfies ProcessEvent;
        }
        yield { type: "exit", code: 0 } satisfies ProcessEvent;
      }),
    };
  }

  it("does nothing when there is room", async () => {
    const box = disk([1000]);
    await ensureFreeSpace(box as never, computer, context);
    expect(box.commands).toHaveLength(1);
  });

  it("cleans first and starts when that frees enough", async () => {
    const box = disk([5, 900]);
    await ensureFreeSpace(box as never, computer, context);
    expect(box.commands).toContain(managedTempCleanupCommand());
  });

  it("fails with the largest directories when clean-up is not enough", async () => {
    const box = disk([5], "486400\t./.codex\n234496\t./.nvm\n1200000\t.\n");
    const error = await ensureFreeSpace(box as never, computer, context).catch((e) => e);
    expect(isSandboxStorageFullError(error)).toBe(true);
    expect(error.usage).toContain(".codex 475 MB");
  });

  it("does not block when the disk cannot be read", async () => {
    const box = {
      execute: vi.fn(async function* () {
        yield { type: "stdout", data: "garbage" } satisfies ProcessEvent;
      }),
    };
    await expect(ensureFreeSpace(box as never, computer, context)).resolves.toBeUndefined();
    expect(MIN_FREE_BYTES).toBe(300 * MB);
  });
});
