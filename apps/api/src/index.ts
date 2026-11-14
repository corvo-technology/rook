import type { Server } from "node:http";
import { loadRootEnv } from "@corvo/core/node/load-root-env";
import { createNovncProxy } from "@corvo/core/node/novnc-proxy";

loadRootEnv();

import { SERVICE_NAMES } from "@corvo/logging";
import { createRootLogger } from "@corvo/logging/axiom";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { createGracefulShutdown } from "./graceful-shutdown.js";
import type { DrainState } from "./health.js";

const logger = createRootLogger(SERVICE_NAMES.api);

try {
  const env = loadEnv();
  const drain: DrainState = { draining: false };
  const { app, egress, stop } = await createApp({ ...env, logger, drain });
  // Plain HTTP: no TLS or HTTP/2 options are passed, so the union's http2 arms cannot occur.
  const server = serve({ fetch: app.fetch, port: env.port, hostname: env.apiHost }, () => {
    logger.info("api listening", { "http.host": env.apiHost, "http.port": env.port });
  }) as Server;

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

  // Behind a proxy, a keep-alive window shorter than the proxy's reuse window makes it write to
  // a socket we just closed.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  // On SIGTERM: fail readiness, keep serving while the platform reroutes, finish in-flight
  // requests, end streams so clients reconnect, all within DRAIN_DEADLINE_MS.
  const shutdown = createGracefulShutdown(server, {
    drain,
    afterClose: async () => {
      await stop();
      await logger.flush({ timeoutMs: 2_000 });
    },
  });
  process.once("SIGTERM", () => void shutdown());
  // Interactive stops have no load balancer to wait for.
  process.once("SIGINT", () => void shutdown({ immediate: true }));
} catch (error) {
  logger.error("api startup failed", error);
  await logger.flush({ timeoutMs: 2_000 });
  process.exit(1);
}
