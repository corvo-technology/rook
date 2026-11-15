import type { Server, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { DrainState } from "./health.js";

/** Time the platform needs to see failing readiness and stop routing here, while we still serve. */
export const READINESS_PROPAGATION_MS = 5_000;
/** Hard bound from SIGTERM to exit. The platform's termination grace period must be at least this. */
export const DRAIN_DEADLINE_MS = 25_000;
const POLL_MS = 100;
/** After a stream's socket is gone, how long its handler gets to unwind before pools close. */
const STREAM_UNWIND_MS = 2_000;

const streams = new WeakSet<ServerResponse>();

/** `getHeader` misses headers passed straight to `writeHead`, so watch both. */
function watchForStream(res: ServerResponse) {
  const isEventStream = (value: unknown) => String(value ?? "").includes("text/event-stream");
  const writeHead = res.writeHead;
  res.writeHead = function (this: ServerResponse, ...args: unknown[]) {
    const headers = args.find((arg) => arg && typeof arg === "object") as
      | Record<string, unknown>
      | unknown[]
      | undefined;
    const type = Array.isArray(headers)
      ? headers.find((_, i) => i % 2 === 0 && String(headers[i]).toLowerCase() === "content-type")
      : headers
        ? Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type")?.[1]
        : undefined;
    if (isEventStream(type ?? this.getHeader("content-type"))) streams.add(this);
    return (writeHead as (...a: unknown[]) => ServerResponse).apply(this, args);
  } as typeof res.writeHead;
}

function isStream(res: ServerResponse): boolean {
  return res.headersSent && streams.has(res);
}

/**
 * Orderly shutdown for a deploy: fail readiness first, keep serving while the platform notices,
 * stop accepting, let in-flight requests finish, end long-lived streams so clients reconnect to
 * the new pod, and destroy whatever remains at the deadline.
 *
 * A request is in flight until its handler settles, not until its socket closes: a client or
 * proxy that hangs up leaves the handler running, and `afterClose` (which ends the DB pools)
 * must not run under it. Once `afterClose` starts, late requests get a 503 instead of reaching
 * handlers that would fail on a closed pool, so clients retry on the new pod.
 */
export function createGracefulShutdown(
  server: Server,
  options: {
    drain: DrainState;
    /** Runs after the server has closed (stop background work, flush logs). */
    afterClose?: () => Promise<void>;
    propagationMs?: number;
    deadlineMs?: number;
  },
) {
  const { drain, afterClose } = options;
  const sockets = new Set<Socket>();
  const active = new Set<ServerResponse>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const handlers = new Set<{ res: ServerResponse; done: Promise<unknown> }>();
  let sealed = false;
  // Replaces the app's listeners, so the response is watched before the app writes its headers
  // and the handler's promise (Hono's listener returns one) is tracked to completion.
  const appListeners = server.listeners("request") as ((...args: unknown[]) => unknown)[];
  server.removeAllListeners("request");
  server.on("request", (req, res) => {
    if (sealed) {
      res.writeHead(503, { "retry-after": "1", connection: "close" }).end();
      return;
    }
    active.add(res);
    watchForStream(res);
    res.once("close", () => active.delete(res));
    for (const listener of appListeners) {
      const result = listener.call(server, req, res);
      if (!result || typeof (result as Promise<unknown>).then !== "function") continue;
      const entry = {
        res,
        done: (result as Promise<unknown>).then(
          () => undefined,
          () => undefined,
        ),
      };
      handlers.add(entry);
      void entry.done.then(() => handlers.delete(entry));
    }
  });

  let stopping: Promise<void> | undefined;
  const run = async (immediate: boolean) => {
    const propagationMs = immediate ? 0 : (options.propagationMs ?? READINESS_PROPAGATION_MS);
    const deadlineMs = options.deadlineMs ?? DRAIN_DEADLINE_MS;
    const startedAt = Date.now();
    drain.draining = true;
    if (propagationMs > 0) await new Promise((resolve) => setTimeout(resolve, propagationMs));
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    const destroyAll = () => {
      for (const socket of sockets) socket.destroy();
    };
    const deadline = setTimeout(destroyAll, Math.max(0, deadlineMs - (Date.now() - startedAt)));
    // Streams never end on their own; every other request is allowed to finish.
    const sweep = setInterval(() => {
      server.closeIdleConnections();
      let busy = false;
      for (const res of active) {
        if (isStream(res)) res.end();
        else busy = true;
      }
      // Upgraded sockets (WebSocket tunnels) are outside the request set: drop them once
      // the regular requests are done.
      if (!busy) destroyAll();
    }, POLL_MS);
    try {
      await closed;
    } finally {
      clearTimeout(deadline);
      clearInterval(sweep);
    }
    // Sockets can be gone while handlers still run (client hang-ups, the deadline's destroy).
    // Streams only get a short unwind: they never finish on their own.
    const unwind = [...handlers].map((entry) =>
      streams.has(entry.res)
        ? Promise.race([entry.done, new Promise((r) => setTimeout(r, STREAM_UNWIND_MS))])
        : entry.done,
    );
    const stuck = new Promise((r) =>
      setTimeout(r, Math.max(0, deadlineMs - (Date.now() - startedAt)) + STREAM_UNWIND_MS),
    );
    await Promise.race([Promise.all(unwind), stuck]);
    sealed = true;
    await afterClose?.();
  };
  return (opts: { immediate?: boolean } = {}) => {
    stopping ??= run(opts.immediate ?? false);
    return stopping;
  };
}
