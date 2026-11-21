import type { AdapterContext, ComputerRef, ProcessEvent } from "@corvo/adapter-kit";
import { createLogger, createTestSink, installLogger } from "@corvo/logging";
import { describe, expect, it, vi } from "vitest";
import {
  ensureFreeSpace,
  freeComputerSpace,
  freeManagedTemp,
  isStorageLow,
  MIN_FREE_BYTES,
  managedTempCleanupCommand,
  PRUNED_BROWSER_CACHE_NAMES,
  REGENERABLE_CACHE_DIRS,
  WARN_FREE_BYTES,
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
  it("only names Rook's own temporary and regenerable cache paths", () => {
    const command = managedTempCleanupCommand();
    const roots = [...command.matchAll(/find ("[^"]+"|\S+)/g)].map((match) => match[1]);
    const homeCaches = ["$HOME", "$HOME/corvo-home"].flatMap((base) =>
      REGENERABLE_CACHE_DIRS.map((dir) => `"${base}/${dir}"`),
    );
    expect(new Set(roots)).toEqual(
      new Set([
        "/tmp/corvo",
        "/tmp",
        '"$HOME"',
        '"$HOME/corvo-home"',
        '"$HOME/corvo-home/.browser-profiles"',
        '"$HOME/.browser-profiles"',
        '"$HOME/.codex/sessions"',
        '"$HOME/.codex/log"',
        ...homeCaches,
      ]),
    );
    expect(REGENERABLE_CACHE_DIRS).toEqual([
      ".npm/_cacache",
      ".npm/_logs",
      ".cache/pip",
      ".cache/pnpm",
      ".local/share/pnpm/store",
      ".cache/chromium",
      ".cache/google-chrome",
      ".config/chromium/Crash Reports",
      ".config/google-chrome/Crash Reports",
    ]);
    const allowed = new Set([
      "observe-*",
      "*.log",
      "corvo-workspace-archive-*",
      "corvo-command-*",
      "corvo-chrome.log",
      "playwright_chromiumdev_profile-*",
      "playwright-artifacts-*",
      ".org.chromium.*",
      ".com.google.Chrome.*",
      "core",
      "core.[0-9]*",
      "CacheStorage",
      ...PRUNED_BROWSER_CACHE_NAMES,
    ]);
    for (const name of command.matchAll(/-name '([^']+)'/g)) expect(allowed).toContain(name[1]);
    expect(command).not.toMatch(
      /Cookies|Login Data|Local Storage|IndexedDB|Preferences|auth\.json|config\.toml|attachments|ms-playwright/,
    );
  });

  it("clears Rook's temp after a day, and core dumps only as plain files", () => {
    const lines = managedTempCleanupCommand().split("; ");
    expect(lines).toContain(
      "find /tmp/corvo -mindepth 1 -maxdepth 1 -mtime +1 -exec rm -rf -- {} + 2>/dev/null",
    );
    const cores = lines.filter((line) => line.includes("'core'"));
    expect(cores).toHaveLength(3);
    for (const line of cores) expect(line).toMatch(/-maxdepth 1 -type f .* -delete/);
  });

  it("empties package-manager and browser caches without removing the directories", () => {
    const lines = managedTempCleanupCommand().split("; ");
    for (const dir of ['"$HOME/.npm/_cacache"', '"$HOME/.cache/pip"', '"$HOME/.cache/pnpm"']) {
      expect(lines).toContain(
        `find ${dir} -mindepth 1 -maxdepth 1 -mmin +3 -exec rm -rf -- {} + 2>/dev/null`,
      );
    }
    expect(PRUNED_BROWSER_CACHE_NAMES).toEqual(
      expect.arrayContaining(["Crashpad", "Crash Reports"]),
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
  const TOTAL_KB = 100 * 1024 * 1024;
  function disk(freeMb: number[], listing = "", totalKb = TOTAL_KB) {
    const commands: string[] = [];
    return {
      commands,
      execute: vi.fn(async function* (_c: ComputerRef, request: { argv: string[] }) {
        const script = request.argv[2] ?? "";
        commands.push(script);
        if (script.startsWith("df")) {
          const free = freeMb.length > 1 ? freeMb.shift() : freeMb[0];
          const freeKb = (free ?? 0) * 1024;
          yield {
            type: "stdout",
            data: `/dev/vda ${totalKb} ${totalKb - freeKb} ${freeKb} 99% /\n`,
          } satisfies ProcessEvent;
        } else if (script.includes("du -xk")) {
          yield { type: "stdout", data: listing } satisfies ProcessEvent;
        }
        yield { type: "exit", code: 0 } satisfies ProcessEvent;
      }),
    };
  }
  function logs() {
    const sink = createTestSink();
    installLogger(createLogger({ service: "test", sinks: [sink] }));
    return sink;
  }
  const quiet = () => installLogger(createLogger({ service: "test", level: "off", sinks: [] }));

  it("does nothing when there is plenty of room", async () => {
    const box = disk([50_000]);
    await expect(ensureFreeSpace(box as never, computer, context)).resolves.toEqual({});
    expect(box.commands).toHaveLength(1);
  });

  it("cleans first and starts when that frees enough, then warns that it is low", async () => {
    const box = disk([5, 900], "2048000\t./.cache\n1200000\t.\n");
    const { low } = await ensureFreeSpace(box as never, computer, context);
    expect(box.commands).toContain(managedTempCleanupCommand());
    expect(low).toMatchObject({ freeBytes: 900 * MB, totalBytes: TOTAL_KB * 1024 });
    expect(low?.usage).toContain(".cache 2000 MB");
  });

  it("warns when free space is under the warning threshold but not full", async () => {
    const box = disk([4000, 4000], "1024\t./.cache\n");
    const { low } = await ensureFreeSpace(box as never, computer, context);
    expect(low?.freeBytes).toBe(4000 * MB);
    expect(isStorageLow({ free: 4000 * MB, total: 100 * 1024 * MB })).toBe(true);
    expect(isStorageLow({ free: 20_000 * MB, total: 100 * 1024 * MB })).toBe(false);
    expect(isStorageLow({ free: WARN_FREE_BYTES, total: 10 * 1024 * MB })).toBe(false);
  });

  it("fails with the largest directories when clean-up is not enough", async () => {
    const box = disk([5], "486400\t./.codex\n234496\t./.nvm\n1200000\t.\n", 2560000);
    const error = await ensureFreeSpace(box as never, computer, context).catch((e) => e);
    expect(isSandboxStorageFullError(error)).toBe(true);
    expect(error.usage).toContain(".codex 475 MB");
    expect(error.disk).toEqual({
      usedBytes: (2560000 - 5 * 1024) * 1024,
      totalBytes: 2560000 * 1024,
    });
  });

  it("logs the disk and the largest directories as structured fields when full", async () => {
    const sink = logs();
    const box = disk([94], "486400\t./.cache\n234496\t./.nvm\n1200000\t.\n");
    await ensureFreeSpace(box as never, computer, context).catch(() => undefined);
    quiet();
    const event = sink.events.find((item) => item.message === "computer.storage.full");
    expect(event).toMatchObject({
      level: "error",
      "disk.free_mb": 94,
      "disk.total_mb": 100 * 1024,
      "disk.largest": expect.stringContaining(".cache 475 MB, .nvm 229 MB"),
    });
    expect(event?.["disk.used_mb"]).toBe(100 * 1024 - 94);
    expect(JSON.stringify(event)).not.toMatch(/content/);
  });

  it("logs how much the clean-up freed", async () => {
    const sink = logs();
    await ensureFreeSpace(disk([5, 900]) as never, computer, context);
    quiet();
    expect(sink.events.find((item) => item.message === "computer.storage.cleaned")).toMatchObject({
      "disk.freed_mb": 895,
    });
  });

  it("reports the room a clean-up on request opened up", async () => {
    const box = disk([5, 205]);
    await expect(freeComputerSpace(box as never, computer, context)).resolves.toEqual({
      freedBytes: 200 * MB,
      freeBytes: 205 * MB,
    });
    expect(box.commands).toContain(managedTempCleanupCommand());
  });

  it("cleans up on request even when the disk cannot be read", async () => {
    const box = {
      execute: vi.fn(async function* () {
        yield { type: "stdout", data: "garbage" } satisfies ProcessEvent;
      }),
    };
    await expect(freeComputerSpace(box as never, computer, context)).resolves.toEqual({
      freedBytes: null,
      freeBytes: null,
    });
  });

  it("does not block when the disk cannot be read", async () => {
    const box = {
      execute: vi.fn(async function* () {
        yield { type: "stdout", data: "garbage" } satisfies ProcessEvent;
      }),
    };
    await expect(ensureFreeSpace(box as never, computer, context)).resolves.toEqual({});
    expect(MIN_FREE_BYTES).toBe(300 * MB);
  });
});
