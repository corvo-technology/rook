import { describe, expect, it, vi } from "vitest";
import {
  HEARTBEAT_RETRY_BACKOFF_MS,
  heartbeatShouldAbort,
  RUN_LEASE_HEARTBEAT_MS,
  RUN_LEASE_TTL_MS,
  renewLeasesTolerantly,
} from "./run-lifecycle.js";

describe("renewLeasesTolerantly", () => {
  it("reports held and lost from the database's own answer without retrying", async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    expect(await renewLeasesTolerantly(async () => true, sleep)).toBe("held");
    expect(await renewLeasesTolerantly(async () => false, sleep)).toBe("lost");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("rides out a short connection blip with backoff", async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const renew = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValue(true);
    expect(await renewLeasesTolerantly(renew, sleep)).toBe("held");
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(HEARTBEAT_RETRY_BACKOFF_MS.slice(0, 2));
  });

  it("gives up as unreachable once every retry threw", async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const renew = vi.fn(async () => {
      throw new Error("database down");
    });
    expect(await renewLeasesTolerantly(renew, sleep)).toBe("unreachable");
    expect(renew).toHaveBeenCalledTimes(HEARTBEAT_RETRY_BACKOFF_MS.length + 1);
  });

  it("keeps a lease lost during a retry as lost", async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const renew = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValue(false);
    expect(await renewLeasesTolerantly(renew, sleep)).toBe("lost");
  });
});

describe("heartbeatShouldAbort", () => {
  const renewedAt = 1_000_000;

  it("aborts at once on a real invalidation", () => {
    expect(heartbeatShouldAbort("lost", renewedAt, renewedAt)).toBe(true);
  });

  it("never aborts a renewed lease", () => {
    expect(heartbeatShouldAbort("held", renewedAt, renewedAt + RUN_LEASE_TTL_MS * 2)).toBe(false);
  });

  it("keeps running through an unreachable database until the lease is about to expire", () => {
    expect(heartbeatShouldAbort("unreachable", renewedAt, renewedAt + RUN_LEASE_HEARTBEAT_MS)).toBe(
      false,
    );
    expect(
      heartbeatShouldAbort(
        "unreachable",
        renewedAt,
        renewedAt + RUN_LEASE_TTL_MS - RUN_LEASE_HEARTBEAT_MS,
      ),
    ).toBe(true);
  });
});
