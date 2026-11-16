import type { AdapterContext, ComputerRef, ProcessEvent } from "@corvo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import {
  freeManagedTemp,
  managedTempCleanupCommand,
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
    expect(roots).toEqual(["/tmp/corvo", "/tmp"]);
    for (const name of command.matchAll(/-name '([^']+)'/g)) {
      expect(name[1]).toMatch(/^(observe-\*|\*\.log|corvo-[a-z.*-]+)$/);
    }
    expect(command).not.toMatch(/\$HOME|~|\/home|corvo-home|attachments/);
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
