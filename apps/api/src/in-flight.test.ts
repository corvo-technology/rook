import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createGracefulShutdown } from "./graceful-shutdown.js";
import { createInFlight } from "./in-flight.js";

/** A pool double that rejects like pg once ended, and takes `ms` per query. */
function fakePool() {
  let ended = false;
  return {
    get ended() {
      return ended;
    },
    async query(ms: number) {
      await new Promise((resolve) => setTimeout(resolve, ms));
      if (ended) throw new Error("Cannot use a pool after calling end on the pool");
    },
    async end() {
      ended = true;
    },
  };
}

/**
 * An event stream whose generator re-checks the session after the response has ended, the way
 * `spaces.subscribe` does through `stillAuthorized`. The handler settles when the response closes;
 * the generator is still awaiting the check.
 */
async function runDrainedStream(
  check: (
    pool: ReturnType<typeof fakePool>,
    inFlight: ReturnType<typeof createInFlight>,
  ) => Promise<void>,
) {
  const pool = fakePool();
  const errors: string[] = [];
  const inFlight = createInFlight();
  const server = createServer(async (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(": hi\n\n");
    const closed = new Promise((resolve) => res.once("close", resolve));
    void (async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await check(pool, inFlight).catch((error: Error) => errors.push(error.message));
    })();
    await closed;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const shutdown = createGracefulShutdown(server, {
    drain: { draining: false },
    propagationMs: 0,
    deadlineMs: 5_000,
    afterClose: async () => {
      await inFlight.close();
      await pool.end();
    },
  });
  const stream = await fetch(base);
  const ended = stream.text();
  // Land the shutdown while the check runs: the check is in flight when the sweep ends the stream.
  await new Promise((resolve) => setTimeout(resolve, 40));
  const stopped = shutdown({ immediate: true });
  await ended;
  await stopped;
  await new Promise((resolve) => setTimeout(resolve, 600));
  return { errors };
}

describe("work that outlives its handler", () => {
  it("reproduces: an untracked session check hits the ended pool", async () => {
    const { errors } = await runDrainedStream((pool) => pool.query(300));
    expect(errors).toEqual(["Cannot use a pool after calling end on the pool"]);
  });

  it("ends the pool only after a tracked session check completes", async () => {
    const { errors } = await runDrainedStream((pool, inFlight) =>
      inFlight.run(() => pool.query(300)),
    );
    expect(errors).toEqual([]);
  });

  it("refuses work started after close", async () => {
    const inFlight = createInFlight();
    await inFlight.close();
    await expect(inFlight.run(async () => "late")).rejects.toThrow("shutting down");
  });

  it("stops waiting for work that never settles", async () => {
    const inFlight = createInFlight();
    void inFlight.run(() => new Promise(() => {})).catch(() => {});
    await inFlight.close(30);
  });
});
