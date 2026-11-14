import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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
});
