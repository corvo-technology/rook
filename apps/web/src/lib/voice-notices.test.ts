import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@corvo/ui-web", () => ({ toast }));

describe("voice notices", () => {
  beforeEach(() => {
    toast.mockClear();
    // Each notice is said once per session, so every test starts a new one.
    vi.resetModules();
  });

  it("says once, with the size, that the speech model is being fetched", async () => {
    const { announceLocalDownload } = await import("./voice-notices.js");
    announceLocalDownload("listen", 207_557_382);
    announceLocalDownload("listen", 207_557_382);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0]?.[0]).toContain("208 MB");
  });

  it("tells the speech model and the voice apart, each once", async () => {
    const { announceLocalDownload } = await import("./voice-notices.js");
    announceLocalDownload("listen", 1_000_000);
    announceLocalDownload("speak", 67_043_814);
    announceLocalDownload("speak", 67_043_814);
    expect(toast).toHaveBeenCalledTimes(2);
    expect(toast.mock.calls[1]?.[0]).toContain("67 MB");
  });

  it("says once that this computer's voice read a reply for a provider that failed", async () => {
    const { announceLocalFallback } = await import("./voice-notices.js");
    announceLocalFallback();
    announceLocalFallback();
    expect(toast).toHaveBeenCalledTimes(1);
  });
});
