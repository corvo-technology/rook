import { describe, expect, it, vi } from "vitest";

vi.mock("./reply-context.js", () => ({ loadReplyContext: async () => undefined }));

import type { ExecutorDeps } from "./executor-deps.js";
import { claimRunSteering, STEERING_DEBOUNCE_MS } from "./run-turn-images.js";

const item = (id: string) => ({
  id: `s-${id}`,
  messageId: id,
  text: `text ${id}`,
  blocks: [{ kind: "text" as const, text: `text ${id}` }],
});
const lease = { threadId: "t", botId: "b", runId: "r", leaseOwner: "w", leaseFence: 1 };

function run(batches: ReturnType<typeof item>[][]) {
  const claimSteering = vi.fn(async () => batches.shift() ?? []);
  const sleep = vi.fn(async () => undefined);
  const deps = { events: { claimSteering }, pacing: { sleep } } as unknown as ExecutorDeps;
  const context = { signal: new AbortController().signal } as Parameters<
    typeof claimRunSteering
  >[3];
  return {
    claimSteering,
    sleep,
    claimed: claimRunSteering(deps, lease, [], context, [], { hasImages: false }),
  };
}

describe("steering debounce", () => {
  it("collects messages sent a moment apart into one steer", async () => {
    const { claimed, sleep, claimSteering } = run([[item("a")], [item("b")], []]);
    const steering = await claimed;
    expect(steering.map((entry) => entry.messageId)).toEqual(["a", "b"]);
    expect(steering[1]!.text).toContain("2 messages are waiting");
    expect(sleep).toHaveBeenCalledWith(STEERING_DEBOUNCE_MS, expect.anything());
    expect(claimSteering).toHaveBeenLastCalledWith(
      expect.objectContaining({ seenIds: ["s-a", "s-b"] }),
    );
  });

  it("does not wait when nothing is queued", async () => {
    const { claimed, sleep } = run([[]]);
    expect(await claimed).toEqual([]);
    expect(sleep).not.toHaveBeenCalled();
  });
});
