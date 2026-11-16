import { MetaCode } from "@corvo/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutorDeps } from "./executor-deps.js";
import { alertHomeLost, HOME_LOST_NOTICE } from "./home-lost-alert.js";

const publishMessage = vi.hoisted(() => vi.fn());
vi.mock("./run-messages.js", () => ({ publishMessage }));

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
});

describe("alertHomeLost", () => {
  it("posts one coded system line", async () => {
    await alertHomeLost(deps, run);
    expect(publishMessage).toHaveBeenCalledTimes(1);
    const [, , role, blocks] = publishMessage.mock.calls[0]!;
    expect(role).toBe("system");
    expect(blocks).toEqual([{ kind: "meta", text: HOME_LOST_NOTICE, code: "computer_home_lost" }]);
    expect(MetaCode.options).toContain("computer_home_lost");
  });

  it("never throws", async () => {
    publishMessage.mockRejectedValue(new Error("db down"));
    await expect(alertHomeLost(deps, run)).resolves.toBeUndefined();
  });
});
