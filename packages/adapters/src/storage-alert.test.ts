import { MetaCode } from "@corvo/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutorDeps } from "./executor-deps.js";
import { alertStorageFull, alertStorageLow } from "./storage-alert.js";

const publishMessage = vi.hoisted(() => vi.fn());
const notifyRun = vi.hoisted(() => vi.fn());
vi.mock("./run-messages.js", () => ({ publishMessage }));
vi.mock("./run-notifications.js", () => ({ notifyRun }));

const deps = {} as ExecutorDeps;
const run = {
  id: "run-1",
  spaceId: "space-1",
  userId: "user-1",
  threadId: "thread-1",
  botId: "bot-1",
  trigger: "user",
};

beforeEach(() => {
  publishMessage.mockReset().mockResolvedValue(null);
  notifyRun.mockReset().mockResolvedValue(undefined);
});

describe("alertStorageFull", () => {
  it("posts a coded system line and one push", async () => {
    await alertStorageFull(deps, run, { id: "bot-1", name: "Ana" });
    const [, , role, blocks] = publishMessage.mock.calls[0]!;
    expect(role).toBe("system");
    expect(blocks).toEqual([
      expect.objectContaining({ kind: "meta", code: "sandbox_storage_full" }),
    ]);
    expect(MetaCode.options).toContain("sandbox_storage_full");
    expect(notifyRun).toHaveBeenCalledWith(
      deps,
      run,
      expect.objectContaining({ kind: "help", botId: "bot-1", threadId: "thread-1" }),
    );
  });

  it("never throws", async () => {
    publishMessage.mockRejectedValue(new Error("db down"));
    await expect(
      alertStorageFull(deps, run, { id: "bot-1", name: "Ana" }),
    ).resolves.toBeUndefined();
  });
});

describe("alertStorageFull details", () => {
  it("carries the disk and the largest directories as params the web words itself", async () => {
    await alertStorageFull(deps, run, { id: "bot-1", name: "Ana" }, ".cache 475 MB", {
      usedBytes: 38 * 1024 * 1024 * 1024,
      totalBytes: 40 * 1024 * 1024 * 1024,
    });
    const [, , , blocks] = publishMessage.mock.calls[0]!;
    expect(blocks[0]).toMatchObject({
      code: "sandbox_storage_full",
      params: { top: ".cache 475 MB", usedMb: "38912", totalMb: "40960" },
    });
    expect(notifyRun.mock.calls[0]![2]).toMatchObject({ storage: "full" });
  });
});

describe("alertStorageLow", () => {
  const low = {
    freeBytes: 2 * 1024 * 1024 * 1024,
    usedBytes: 38 * 1024 * 1024 * 1024,
    totalBytes: 40 * 1024 * 1024 * 1024,
    usage: ".cache 12000 MB",
  };

  it("posts one coded line with the largest directories and an inbox alert", async () => {
    await alertStorageLow(deps, run, { id: "bot-1", name: "Ana" }, low);
    expect(publishMessage).toHaveBeenCalledTimes(1);
    const [, , role, blocks] = publishMessage.mock.calls[0]!;
    expect(role).toBe("system");
    expect(blocks[0]).toMatchObject({
      kind: "meta",
      code: "sandbox_storage_low",
      params: { top: ".cache 12000 MB", usedMb: "38912", totalMb: "40960" },
    });
    expect(MetaCode.options).toContain("sandbox_storage_low");
    expect(notifyRun).toHaveBeenCalledWith(
      deps,
      run,
      expect.objectContaining({
        kind: "help",
        storage: "low",
        title: "Ana's computer is almost full",
      }),
      { inbox: "alert" },
    );
  });

  it("never throws", async () => {
    publishMessage.mockRejectedValue(new Error("db down"));
    await expect(
      alertStorageLow(deps, run, { id: "bot-1", name: "Ana" }, low),
    ).resolves.toBeUndefined();
  });
});
