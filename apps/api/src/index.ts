import type { Socket } from "node:net";
import { loadRootEnv } from "@corvo/core/node/load-root-env";
import { createNovncProxy } from "@corvo/core/node/novnc-proxy";

loadRootEnv();

import { SERVICE_NAMES } from "@corvo/logging";
import { createRootLogger } from "@corvo/logging/axiom";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";

const logger = createRootLogger(SERVICE_NAMES.api);

try {
  const env = loadEnv();
  const { app, egress, stop } = await createApp({ ...env, logger });
  const server = serve({ fetch: app.fetch, port: env.port, hostname: env.apiHost }, () => {
    logger.info("api listening", { "http.host": env.apiHost, "http.port": env.port });
  });

  // The desktop app has no separate web server, so the API is also the origin that serves the
  // computer screen. A hosted stack answers these paths in its web server instead.
  if (process.env.SCREEN_PROXY_IN_API === "1") {
    const screen = createNovncProxy({
      secret: env.screenProxySecret,
      api: `http://127.0.0.1:${env.port}`,
      log: logger,
    });
    const respond = server.listeners("request");
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      void screen.request(req, res).then((handled) => {
        if (handled) return;
        for (const listener of respond) listener.call(server, req, res);
      });
    });
    server.on("upgrade", (req, socket, head) => void screen.upgrade(req, socket, head));
  }

  // Computers tunnel their browsers through the egress gateway over WebSocket on the API host,
  // so no extra port is needed. It ignores every other upgrade path.
  if (egress) server.on("upgrade", (req, socket, head) => void egress.upgrade(req, socket, head));

  // Long-lived connections (threads.subscribe SSE streams) never end on their
  // own, so server.close() alone waits forever for them. Track sockets and
  // force-close any still open after a short grace period for in-flight
  // requests, or every restart/shutdown hangs until something force-kills it.
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    const grace = setTimeout(() => {
      for (const socket of sockets) socket.destroy();
    }, 2_000);
    await closed;
    clearTimeout(grace);
    await stop();
    await logger.flush({ timeoutMs: 2_000 });
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
} catch (error) {
  logger.error("api startup failed", error);
  await logger.flush({ timeoutMs: 2_000 });
  process.exit(1);
}
