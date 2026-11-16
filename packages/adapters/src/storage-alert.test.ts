import { MetaCode } from "@corvo/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutorDeps } from "./executor-deps.js";
import { alertStorageFull } from "./storage-alert.js";

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
