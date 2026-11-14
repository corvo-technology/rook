import { describe, expect, it, vi } from "vitest";
import { isRetrySafeCall, retryTransient, TRANSIENT_RETRY_WINDOW_MS } from "./transient-retry.js";

function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    random: () => 0,
  };
}

describe("retryTransient", () => {
  it.each([502, 503, 504])("retries a %i until the server answers", async (status) => {
    const c = clock();
    const send = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response("", { status }))
      .mockResolvedValueOnce(new Response("", { status }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const res = await retryTransient(send, c);
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("retries a network failure", async () => {
    const send = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("ok"));
    expect((await retryTransient(send, clock())).status).toBe(200);
  });

  it("stops after the window and surfaces the last failure", async () => {
    const c = clock();
    const send = vi.fn(async () => new Response("", { status: 503 }));
    const res = await retryTransient(send, c);
    expect(res.status).toBe(503);
    expect(c.now()).toBeLessThanOrEqual(TRANSIENT_RETRY_WINDOW_MS);
    expect(send.mock.calls.length).toBeGreaterThan(4);
    const failing = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(retryTransient(failing, clock())).rejects.toThrow("Failed to fetch");
  });

  it.each([400, 401, 404, 409, 500])("does not retry a %i", async (status) => {
    const send = vi.fn(async () => new Response("", { status }));
    expect((await retryTransient(send, clock())).status).toBe(status);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not retry once the caller aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const send = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(retryTransient(send, { ...clock(), signal: controller.signal })).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("reports the retrying state", async () => {
    const states: boolean[] = [];
    const send = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response("", { status: 502 }))
      .mockResolvedValueOnce(new Response("ok"));
    await retryTransient(send, { ...clock(), onRetrying: (s) => states.push(s) });
    expect(states).toEqual([true, false]);
  });
});

describe("isRetrySafeCall", () => {
  it("retries sends only when they carry a client nonce", () => {
    expect(isRetrySafeCall("threads/send", { clientNonce: "n" })).toBe(true);
    expect(isRetrySafeCall("threads/send", { text: "old client" })).toBe(false);
    expect(isRetrySafeCall("threads/markRead", {})).toBe(true);
    expect(isRetrySafeCall("bots/delete", {})).toBe(false);
  });
});
