import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import { pipeline, Transform } from "node:stream";
import tls from "node:tls";
import type { PrismaClient } from "@corvo/db";
import {
  creditAccount,
  recordModelCreditReceipt,
  reserveModelCredits,
  runAsSystem,
  settleModelCredits,
} from "@corvo/db";
import { getLogger } from "@corvo/logging";
import { createWebSocketStream, WebSocketServer } from "ws";
import type { BrowserEgressConfig, EgressUpstream } from "./browser-egress.js";
import {
  BROWSER_EGRESS_ERROR_HEADER,
  BROWSER_EGRESS_PATH,
  EGRESS_CREDITS_USED_UP,
  egressUpstream,
  openEgressCapability,
  refusedEgressDestination,
} from "./browser-egress.js";

const BYTES_PER_GB = 1e9;
/** Credit is held and settled in blocks this size, not per packet or per connection. */
export const EGRESS_BATCH_BYTES = 16 * 1024 * 1024;
/** A bot's block stays open this long after its last tunnel closes, so one page load is one charge. */
const IDLE_SETTLE_MS = 5_000;
const UPSTREAM_CONNECT_MS = 15_000;
export const EGRESS_PROVIDER_ID = "browser-egress";

class EgressCreditsError extends Error {}

export interface EgressMeterOptions {
  prisma: PrismaClient;
  /** Undefined when billing credits are off: bytes are counted and nothing is charged. */
  billing?: { organizationId: string; usdPerGb: number };
  spaceId: string;
}

/**
 * One bot's bytes, shared by all its open tunnels. Credit is held a block at a time and each block
 * is settled at the bytes it really carried, so a page with dozens of connections is a few writes.
 */
export class EgressMeter {
  private entryId: string | undefined;
  private entryBytes = 0;
  private connections = 0;
  private idle: NodeJS.Timeout | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  totalBytes = 0;

  constructor(
    private readonly options: EgressMeterOptions,
    private readonly onIdle: () => void = () => undefined,
  ) {}

  /** Opens a tunnel. Throws when the account cannot fund the bytes that follow. */
  async open(): Promise<void> {
    this.connections += 1;
    this.cancelIdle();
    try {
      if (!this.entryId) await this.exclusive(() => this.hold());
    } catch (error) {
      this.connections -= 1;
      this.scheduleIdle();
      throw error;
    }
  }

  close(): void {
    this.connections = Math.max(0, this.connections - 1);
    if (this.connections === 0) this.scheduleIdle();
  }

  async charge(bytes: number): Promise<void> {
    this.totalBytes += bytes;
    if (!this.options.billing) return;
    let remaining = bytes;
    while (remaining > 0) {
      if (!this.entryId) await this.exclusive(() => this.hold());
      const room = EGRESS_BATCH_BYTES - this.entryBytes;
      if (room <= 0) {
        await this.exclusive(() => this.rollover());
        continue;
      }
      const take = Math.min(remaining, room);
      this.entryBytes += take;
      remaining -= take;
    }
  }

  /** Settles the open block at the bytes it carried. */
  async flush(): Promise<void> {
    this.cancelIdle();
    await this.exclusive(() => this.settle());
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async hold(): Promise<void> {
    const { billing, prisma, spaceId } = this.options;
    if (!billing || this.entryId) return;
    try {
      this.entryId = await reserveModelCredits(
        prisma,
        billing.organizationId,
        (EGRESS_BATCH_BYTES / BYTES_PER_GB) * billing.usdPerGb,
        {
          callId: `egress:${randomUUID()}`,
          spaceId,
          provider: EGRESS_PROVIDER_ID,
          model: "residential-proxy",
        },
      );
      this.entryBytes = 0;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Not enough model credits"))
        throw new EgressCreditsError(EGRESS_CREDITS_USED_UP);
      throw error;
    }
  }

  private async rollover(): Promise<void> {
    if (this.entryBytes < EGRESS_BATCH_BYTES) return;
    await this.settle();
    await this.hold();
  }

  /** A failed release leaves the hold for the credit reconciler; it must not break a tunnel. */
  private async settle(): Promise<void> {
    const { billing, prisma } = this.options;
    const entryId = this.entryId;
    if (!billing || !entryId) return;
    const costUsd = (this.entryBytes / BYTES_PER_GB) * billing.usdPerGb;
    this.entryId = undefined;
    this.entryBytes = 0;
    try {
      await recordModelCreditReceipt(prisma, entryId, {
        inputTokens: null,
        outputTokens: null,
        costUsd,
        costSource: "estimated",
      });
      await settleModelCredits(prisma, entryId, costUsd);
    } catch (error) {
      getLogger().warn("browser egress credit settlement failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private scheduleIdle() {
    this.cancelIdle();
    this.idle = setTimeout(() => {
      this.idle = undefined;
      void this.exclusive(() => this.settle()).then(() => {
        if (this.connections === 0) this.onIdle();
      });
    }, IDLE_SETTLE_MS);
    this.idle.unref();
  }

  private cancelIdle() {
    if (this.idle) clearTimeout(this.idle);
    this.idle = undefined;
  }
}

/** HTTP CONNECT through the provider; resolves with the connected socket once it says 200. */
export function openProviderTunnel(
  upstream: EgressUpstream,
  host: string,
  port: number,
  timeoutMs = UPSTREAM_CONNECT_MS,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket =
      upstream.protocol === "https:"
        ? tls.connect({ host: upstream.host, port: upstream.port, servername: upstream.host })
        : net.connect({ host: upstream.host, port: upstream.port });
    const fail = (message: string) => {
      socket.destroy();
      reject(new Error(message));
    };
    // Never put the provider's address or the error text in the message: callers relay it.
    socket.setTimeout(timeoutMs, () => fail("provider timed out"));
    socket.once("error", () => fail("provider unreachable"));
    let head = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end < 0) {
        if (head.length > 16 * 1024) fail("provider reply too large");
        return;
      }
      socket.off("data", onData);
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(head.toString("latin1", 0, end))?.[1]);
      if (status !== 200) return fail(`provider refused (${status || "invalid reply"})`);
      socket.setTimeout(0);
      socket.removeAllListeners("error");
      const rest = head.subarray(end + 4);
      if (rest.length) socket.unshift(rest);
      resolve(socket);
    };
    const connected = upstream.protocol === "https:" ? "secureConnect" : "connect";
    socket.once(connected, () => {
      const target = net.isIPv6(host) ? `[${host}]:${port}` : `${host}:${port}`;
      socket.write(
        `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${
          upstream.authorization ? `Proxy-Authorization: ${upstream.authorization}\r\n` : ""
        }\r\n`,
      );
      socket.on("data", onData);
    });
  });
}

export interface EgressGatewayOptions {
  prisma: PrismaClient;
  config: BrowserEgressConfig;
  /** From `egressCapabilityKey`. */
  key: Buffer;
  /** Billing credits are on: every byte is paid from the organization's balance. */
  metered: boolean;
}

export interface EgressGateway {
  /** True when the request was for the gateway, whether or not it was allowed. */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean;
  stop(): Promise<void>;
}

function refuse(socket: Duplex, status: number, reason: string, code?: string) {
  if (socket.destroyed) return;
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n${
      code ? `${BROWSER_EGRESS_ERROR_HEADER}: ${code}\r\n` : ""
    }\r\n`,
  );
}

/**
 * The Rook-side forward proxy for agent browsers. A computer opens a WebSocket per tunnel with its
 * bot capability and the destination; the gateway checks both, dials the provider with the
 * provider credential (which no computer ever sees), and meters the bytes against credits.
 */
export function createEgressGateway(options: EgressGatewayOptions): EgressGateway {
  const { prisma, config, key, metered } = options;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  const meters = new Map<string, EgressMeter>();

  async function meterFor(botId: string, spaceId: string): Promise<EgressMeter | "denied"> {
    const bot = await runAsSystem("authorize browser egress", () =>
      prisma.bot.findFirst({
        where: { id: botId, spaceId, archivedAt: null },
        select: { space: { select: { organizationId: true } } },
      }),
    );
    if (!bot) return "denied";
    const existing = meters.get(botId);
    if (existing) return existing;
    let billing: EgressMeterOptions["billing"];
    if (metered) {
      const organizationId = bot.space.organizationId;
      const account = await runAsSystem("check browser egress credits", () =>
        creditAccount(prisma, organizationId),
      );
      // Metered egress needs an organization on credits, the same rule voice follows.
      if (account.mode !== "credits" || !config.usdPerGb)
        throw new EgressCreditsError(EGRESS_CREDITS_USED_UP);
      billing = { organizationId, usdPerGb: config.usdPerGb };
    }
    const meter = new EgressMeter({ prisma, spaceId, ...(billing ? { billing } : {}) }, () => {
      if (meters.get(botId) === meter) meters.delete(botId);
    });
    meters.set(botId, meter);
    return meter;
  }

  async function handle(req: IncomingMessage, socket: Duplex, head: Buffer, url: URL) {
    if (req.headers.upgrade?.toLowerCase() !== "websocket")
      return refuse(socket, 400, "Bad Request");
    const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1];
    const scope = openEgressCapability(key, bearer);
    if (!scope) return refuse(socket, 401, "Unauthorized");
    const host = url.searchParams.get("host") ?? "";
    const port = Number(url.searchParams.get("port"));
    if (refusedEgressDestination(host, port)) return refuse(socket, 403, "Forbidden");

    let meter: EgressMeter | "denied";
    try {
      meter = await meterFor(scope.botId, scope.spaceId);
      if (meter !== "denied") await meter.open();
    } catch (error) {
      if (error instanceof EgressCreditsError)
        return refuse(socket, 402, "Payment Required", EGRESS_CREDITS_USED_UP);
      getLogger().warn("browser egress authorization failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      return refuse(socket, 503, "Service Unavailable");
    }
    if (meter === "denied") return refuse(socket, 403, "Forbidden");

    let provider: net.Socket;
    try {
      provider = await openProviderTunnel(
        egressUpstream(config.proxyUrl, scope.botId),
        host.replace(/^\[|\]$/g, ""),
        port,
      );
    } catch (error) {
      meter.close();
      getLogger().warn("browser egress provider failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      return refuse(socket, 502, "Bad Gateway");
    }
    if (socket.destroyed) {
      provider.destroy();
      meter.close();
      return;
    }
    wss.handleUpgrade(req, socket as net.Socket, head, (ws) => {
      const client = createWebSocketStream(ws);
      const count = () =>
        new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            (meter as EgressMeter).charge(chunk.length).then(
              () => callback(null, chunk),
              (error) => callback(error),
            );
          },
        });
      let open = 2;
      let ended = false;
      const end = (error?: Error | null) => {
        open -= 1;
        if (ended || (!error && open > 0)) return;
        ended = true;
        provider.destroy();
        client.destroy();
        ws.terminate();
        (meter as EgressMeter).close();
      };
      pipeline(client, count(), provider, end);
      pipeline(provider, count(), client, end);
    });
  }

  return {
    upgrade(req, socket, head) {
      const url = new URL(req.url ?? "/", "http://gateway");
      if (url.pathname !== BROWSER_EGRESS_PATH) return false;
      void handle(req, socket, head, url).catch(() => refuse(socket, 500, "Internal Server Error"));
      return true;
    },
    async stop() {
      wss.close();
      await Promise.all([...meters.values()].map((meter) => meter.flush()));
    },
  };
}
