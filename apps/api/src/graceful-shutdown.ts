import type { Server, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { DrainState } from "./health.js";

/** Time the platform needs to see failing readiness and stop routing here, while we still serve. */
export const READINESS_PROPAGATION_MS = 5_000;
/** Hard bound from SIGTERM to exit. The platform's termination grace period must be at least this. */
export const DRAIN_DEADLINE_MS = 25_000;
const POLL_MS = 100;

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
  // First in line, so the response is watched before the app writes its headers.
  server.prependListener("request", (_req, res) => {
    active.add(res);
    watchForStream(res);
    res.once("close", () => active.delete(res));
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
    await afterClose?.();
  };
  return (opts: { immediate?: boolean } = {}) => {
    stopping ??= run(opts.immediate ?? false);
    return stopping;
  };
}
