import { createServer, IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createGracefulShutdown } from "./graceful-shutdown.js";
import { healthRoutes } from "./health.js";

describe("graceful shutdown", () => {
  it("fails readiness first, finishes in-flight requests and ends streams", async () => {
    const drain = { draining: false };
    const health = healthRoutes(() => ({}), undefined, drain);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = createServer(async (req, res) => {
      if (req.url === "/ready") {
        const r = await health.request("/ready");
        res.writeHead(r.status).end(await r.text());
      } else if (req.url === "/stream") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(": hi\n\n");
      } else {
        await gate;
        res.writeHead(200).end("done");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    let closed = false;
    const shutdown = createGracefulShutdown(server, {
      drain,
      propagationMs: 150,
      deadlineMs: 5_000,
      afterClose: async () => {
        closed = true;
      },
    });
    const slow = fetch(`${base}/slow`).then((r) => r.text());
    const stream = await fetch(`${base}/stream`);
    const streamEnded = stream.text();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const stopped = shutdown();
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Readiness fails while the listener still accepts connections.
    expect(await (await fetch(`${base}/ready`)).status).toBe(503);
    expect(closed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 300));
    // The stream is ended, but the in-flight request keeps the server open.
    await streamEnded;
    expect(closed).toBe(false);
    release();
    await expect(slow).resolves.toBe("done");
    await stopped;
    expect(closed).toBe(true);
    await expect(fetch(`${base}/ready`)).rejects.toThrow();
  });

  it("destroys what is left at the deadline", async () => {
    const drain = { draining: false };
    const server = createServer(() => {});
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const shutdown = createGracefulShutdown(server, { drain, propagationMs: 0, deadlineMs: 200 });
    const hung = fetch(`${base}/hang`).catch(() => "reset");
    await new Promise((resolve) => setTimeout(resolve, 50));
    await shutdown();
    await expect(hung).resolves.toBe("reset");
  });

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
        return "session";
      },
      async end() {
        ended = true;
      },
    };
  }

  it("ends the pool only after an in-flight auth lookup completes", async () => {
    const drain = { draining: false };
    const pool = fakePool();
    const server = createServer(async (_req, res) => {
      try {
        res.writeHead(200).end(await pool.query(400));
      } catch {
        res.writeHead(500).end("auth.request.failed");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const shutdown = createGracefulShutdown(server, {
      drain,
      propagationMs: 50,
      deadlineMs: 5_000,
      afterClose: () => pool.end(),
    });
    const lookup = fetch(`${base}/get-session`).then(async (r) => [r.status, await r.text()]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const stopped = shutdown();
    await expect(lookup).resolves.toEqual([200, "session"]);
    expect(pool.ended).toBe(false);
    await stopped;
    expect(pool.ended).toBe(true);
  });

  it("waits for a handler whose client already disconnected", async () => {
    const drain = { draining: false };
    const pool = fakePool();
    let outcome = "pending";
    const server = createServer(async (_req, res) => {
      try {
        await pool.query(400);
        outcome = "ok";
        res.writeHead(200).end();
      } catch {
        outcome = "pool ended";
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const shutdown = createGracefulShutdown(server, {
      drain,
      propagationMs: 0,
      deadlineMs: 5_000,
      afterClose: () => pool.end(),
    });
    const abort = new AbortController();
    const lookup = fetch(`${base}/get-session`, { signal: abort.signal }).catch(() => "aborted");
    await new Promise((resolve) => setTimeout(resolve, 50));
    abort.abort();
    await lookup;
    await shutdown();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(outcome).toBe("ok");
  });

  it("answers 503 to a request that reaches the server once the pools are closing", async () => {
    const drain = { draining: false };
    let reachedApp = 0;
    const server = createServer((_req, res) => {
      reachedApp++;
      res.writeHead(200).end("app");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    let late: number | undefined;
    const shutdown = createGracefulShutdown(server, {
      drain,
      propagationMs: 0,
      deadlineMs: 5_000,
      afterClose: async () => {
        // The listener is closed, so emit the request the way a lingering socket would.
        const wire: Buffer[] = [];
        const socket = new Writable({
          write(chunk, _encoding, done) {
            wire.push(chunk);
            done();
          },
        }) as unknown as Socket;
        const req = new IncomingMessage(socket);
        const res = new ServerResponse(req);
        res.assignSocket(socket);
        server.emit("request", req, res);
        await new Promise((resolve) => setImmediate(resolve));
        late = Number(/^HTTP\/1\.1 (\d+)/.exec(Buffer.concat(wire).toString())?.[1]);
      },
    });
    await shutdown();
    expect(late).toBe(503);
    expect(reachedApp).toBe(0);
  });
});
