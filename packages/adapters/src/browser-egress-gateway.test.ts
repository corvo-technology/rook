import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { EGRESS_FORWARDER_PROGRAM } from "@corvo/core/node/desktop-runtime";
import type { PrismaClient } from "@corvo/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

const db = vi.hoisted(() => ({
  runAsSystem: vi.fn(),
  creditAccount: vi.fn(),
  reserveModelCredits: vi.fn(),
  settleModelCredits: vi.fn(),
  recordModelCreditReceipt: vi.fn(),
}));
vi.mock("@corvo/db", () => db);
const logs = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("@corvo/logging", () => ({ getLogger: () => logs }));

import {
  BROWSER_EGRESS_ERROR_HEADER,
  BROWSER_EGRESS_PATH,
  egressCapabilityKey,
  egressSessionId,
  sealEgressCapability,
} from "./browser-egress.js";
import type { EgressGateway } from "./browser-egress-gateway.js";
import { createEgressGateway, EGRESS_BATCH_BYTES, EgressMeter } from "./browser-egress-gateway.js";

const SECRET = "provider-password-123";
const key = egressCapabilityKey("master");
const sealed = (botId = "bot-a", spaceId = "space") =>
  sealEgressCapability(key, { botId, spaceId });

interface Provider {
  port: number;
  heads: string[];
  connections: number;
  close(): Promise<void>;
}

/** A fake residential provider: accepts CONNECT, then echoes every byte. */
async function fakeProvider(): Promise<Provider> {
  const state = { heads: [] as string[], connections: 0 };
  const server = net.createServer((socket) => {
    state.connections += 1;
    let head = "";
    let tunneled = false;
    socket.on("data", (chunk) => {
      if (tunneled) return void socket.write(chunk);
      head += chunk.toString("latin1");
      const end = head.indexOf("\r\n\r\n");
      if (end < 0) return;
      state.heads.push(head.slice(0, end));
      tunneled = true;
      socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
      const rest = head.slice(end + 4);
      if (rest) socket.write(rest);
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    ...state,
    get heads() {
      return state.heads;
    },
    get connections() {
      return state.connections;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  } as Provider;
}

let provider: Provider;
let http1: HttpServer;
let gateway: EgressGateway;
let gatewayPort: number;

async function start(metered: boolean, usdPerGb = 5) {
  gateway = createEgressGateway({
    prisma: {
      bot: { findFirst: async () => ({ space: { organizationId: "org" } }) },
    } as never as PrismaClient,
    config: {
      proxyUrl: `http://user-{session}:${SECRET}@127.0.0.1:${provider.port}`,
      usdPerGb,
      gatewayOrigin: "http://unused.test",
    },
    key,
    metered,
  });
  http1 = http.createServer();
  http1.on("upgrade", (req, socket, head) => {
    if (!gateway.upgrade(req, socket, head)) socket.destroy();
  });
  await new Promise<void>((resolve) => http1.listen(0, "127.0.0.1", resolve));
  gatewayPort = (http1.address() as net.AddressInfo).port;
}

const url = (host = "example.com", port = 443) =>
  `ws://127.0.0.1:${gatewayPort}${BROWSER_EGRESS_PATH}?host=${encodeURIComponent(host)}&port=${port}`;

/** Resolves with the HTTP refusal, or "open" when the tunnel was accepted. */
function attempt(target: string, capability?: string) {
  return new Promise<{ status: number | "open"; code?: string; body: string; ws?: WebSocket }>(
    (resolve) => {
      const ws = new WebSocket(target, {
        headers: capability ? { authorization: `Bearer ${capability}` } : {},
      });
      ws.on("open", () => resolve({ status: "open", body: "", ws }));
      ws.on("unexpected-response", (_req, res) => {
        resolve({
          status: res.statusCode ?? 0,
          code: res.headers[BROWSER_EGRESS_ERROR_HEADER] as string | undefined,
          body: "",
        });
        res.resume();
      });
      ws.on("error", () => undefined);
    },
  );
}

function roundTrip(ws: WebSocket, bytes: Buffer) {
  return new Promise<number>((resolve) => {
    let received = 0;
    ws.on("message", (data: Buffer) => {
      received += data.length;
      if (received >= bytes.length) resolve(received);
    });
    ws.send(bytes);
  });
}

beforeEach(async () => {
  for (const fn of [...Object.values(db), ...Object.values(logs)]) fn.mockReset();
  db.runAsSystem.mockImplementation(async (_reason: string, work: () => unknown) => work());
  db.creditAccount.mockResolvedValue({ mode: "credits" });
  db.reserveModelCredits.mockResolvedValue("entry");
  db.settleModelCredits.mockResolvedValue(undefined);
  db.recordModelCreditReceipt.mockResolvedValue(undefined);
  provider = await fakeProvider();
});

afterEach(async () => {
  await gateway.stop();
  await new Promise((resolve) => http1.close(resolve));
  http1.closeAllConnections();
  await provider.close();
});

describe("egress gateway", () => {
  it("refuses missing, forged and expired capabilities before touching the provider", async () => {
    await start(true);
    const forged = sealEgressCapability(egressCapabilityKey("other"), {
      botId: "bot-a",
      spaceId: "space",
    });
    const expired = sealEgressCapability(key, { botId: "bot-a", spaceId: "space" }, 0, 1);
    for (const capability of [undefined, "v1.x.y", forged, expired])
      expect((await attempt(url(), capability)).status).toBe(401);
    expect(provider.connections).toBe(0);
    expect(db.reserveModelCredits).not.toHaveBeenCalled();
  });

  it("refuses private destinations and abuse ports", async () => {
    await start(true);
    for (const [host, port] of [
      ["127.0.0.1", 443],
      ["10.0.0.9", 443],
      ["169.254.169.254", 80],
      ["localhost", 443],
      ["example.com", 25],
    ] as const)
      expect((await attempt(url(host, port), sealed())).status).toBe(403);
    expect(provider.connections).toBe(0);
  });

  it("refuses a capability for a bot that is gone", async () => {
    await start(true);
    gateway = createEgressGateway({
      prisma: { bot: { findFirst: async () => null } } as never as PrismaClient,
      config: {
        proxyUrl: `http://127.0.0.1:${provider.port}`,
        usdPerGb: 5,
        gatewayOrigin: "http://x.test",
      },
      key,
      metered: true,
    });
    http1.removeAllListeners("upgrade");
    http1.on("upgrade", (req, socket, head) => void gateway.upgrade(req, socket, head));
    expect((await attempt(url(), sealed())).status).toBe(403);
  });

  it("gives each bot its own sticky provider session and never exposes the provider secret", async () => {
    await start(false);
    for (const bot of ["bot-a", "bot-b", "bot-a"]) {
      const opened = await attempt(url("example.com", 443), sealed(bot));
      expect(opened.status).toBe("open");
      opened.ws?.close();
    }
    const users = provider.heads.map((head) => {
      expect(head.startsWith("CONNECT example.com:443 HTTP/1.1")).toBe(true);
      const auth = /Proxy-Authorization: Basic (\S+)/.exec(head)?.[1] ?? "";
      return Buffer.from(auth, "base64").toString();
    });
    expect(users[0]).toBe(`user-${egressSessionId("bot-a")}:${SECRET}`);
    expect(users[1]).toBe(`user-${egressSessionId("bot-b")}:${SECRET}`);
    expect(users[2]).toBe(users[0]);
    expect(users[1]).not.toBe(users[0]);
  });

  it("counts bytes in both directions and settles them to credits", async () => {
    await start(true, 5);
    const opened = await attempt(url(), sealed());
    expect(opened.status).toBe("open");
    expect(await roundTrip(opened.ws as WebSocket, Buffer.alloc(100_000, 1))).toBe(100_000);
    opened.ws?.close();
    await vi.waitFor(() => expect(provider.connections).toBe(1));
    await gateway.stop();
    // 100 kB up and 100 kB back, at five dollars a gigabyte.
    expect(db.reserveModelCredits).toHaveBeenCalledTimes(1);
    expect(db.reserveModelCredits.mock.calls[0]?.[1]).toBe("org");
    expect(db.settleModelCredits).toHaveBeenCalledTimes(1);
    expect(db.settleModelCredits.mock.calls[0]?.[1]).toBe("entry");
    expect(db.settleModelCredits.mock.calls[0]?.[2]).toBeCloseTo((200_000 / 1e9) * 5, 9);
  });

  it("refuses new connections when the organization is out of credits", async () => {
    await start(true);
    db.reserveModelCredits.mockRejectedValue(new Error("Not enough model credits"));
    const refused = await attempt(url(), sealed());
    expect(refused.status).toBe(402);
    expect(refused.code).toBe("EGRESS_CREDITS_USED_UP");
    expect(provider.connections).toBe(0);
  });

  it("refuses an organization that is not on credits when billing credits are on", async () => {
    await start(true);
    db.creditAccount.mockResolvedValue({ mode: "subscription" });
    expect((await attempt(url(), sealed())).status).toBe(402);
    expect(db.reserveModelCredits).not.toHaveBeenCalled();
  });

  it("charges nothing when billing credits are off", async () => {
    await start(false);
    const opened = await attempt(url(), sealed());
    expect(opened.status).toBe("open");
    expect(await roundTrip(opened.ws as WebSocket, Buffer.alloc(50_000, 2))).toBe(50_000);
    opened.ws?.close();
    await gateway.stop();
    expect(db.creditAccount).not.toHaveBeenCalled();
    expect(db.reserveModelCredits).not.toHaveBeenCalled();
    expect(db.settleModelCredits).not.toHaveBeenCalled();
  });

  it("answers a provider failure with a plain error that carries no secret", async () => {
    await start(false);
    await provider.close();
    const failed = await attempt(url(), sealed());
    expect(failed.status).toBe(502);
    const logged = JSON.stringify([logs.warn.mock.calls, logs.error.mock.calls]);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(String(provider.port));
    provider = await fakeProvider();
  });
});

describe("EgressMeter", () => {
  it("holds and settles credit a block at a time", async () => {
    db.reserveModelCredits.mockImplementation(
      async () => `entry-${db.reserveModelCredits.mock.calls.length}`,
    );
    const meter = new EgressMeter({
      prisma: {} as PrismaClient,
      spaceId: "space",
      billing: { organizationId: "org", usdPerGb: 10 },
    });
    await meter.open();
    await meter.charge(EGRESS_BATCH_BYTES * 2.5);
    expect(db.reserveModelCredits).toHaveBeenCalledTimes(3);
    expect(db.settleModelCredits).toHaveBeenCalledTimes(2);
    const full = (EGRESS_BATCH_BYTES / 1e9) * 10;
    expect(db.settleModelCredits.mock.calls[0]?.[2]).toBeCloseTo(full, 9);
    await meter.flush();
    expect(db.settleModelCredits).toHaveBeenCalledTimes(3);
    expect(db.settleModelCredits.mock.calls[2]?.[2]).toBeCloseTo(full / 2, 9);
    meter.close();
  });
});

describe("computer-side forwarder", () => {
  let dir: string;
  let child: ReturnType<typeof spawn> | undefined;
  afterEach(() => {
    child?.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  async function forwarder(capability: string) {
    dir = mkdtempSync(path.join(tmpdir(), "egress-"));
    writeFileSync(path.join(dir, "forwarder.py"), EGRESS_FORWARDER_PROGRAM);
    writeFileSync(
      path.join(dir, "conf.json"),
      JSON.stringify({
        gateway: `ws://127.0.0.1:${gatewayPort}${BROWSER_EGRESS_PATH}`,
        capability,
      }),
    );
    child = spawn("python3", [
      path.join(dir, "forwarder.py"),
      path.join(dir, "conf.json"),
      path.join(dir, "port"),
    ]);
    await vi.waitFor(() => expect(readFileSync(path.join(dir, "port"), "utf8")).toMatch(/^\d+$/), {
      timeout: 5000,
    });
    return Number(readFileSync(path.join(dir, "port"), "utf8"));
  }

  const exchange = (port: number, request: string, until: RegExp) =>
    new Promise<string>((resolve, reject) => {
      const socket = net.connect(port, "127.0.0.1", () => socket.write(request));
      let text = "";
      socket.on("data", (chunk) => {
        text += chunk.toString("latin1");
        if (until.test(text)) {
          socket.destroy();
          resolve(text);
        }
      });
      socket.on("error", reject);
      setTimeout(() => reject(new Error(`timed out: ${text}`)), 8000);
    });

  it("tunnels a CONNECT through the gateway and meters it", async () => {
    await start(true, 5);
    const port = await forwarder(sealed());
    const answer = await exchange(
      port,
      "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\nhello",
      /hello/,
    );
    expect(answer).toContain("200 Connection Established");
    expect(provider.heads[0]).toContain("CONNECT example.com:443 HTTP/1.1");
    await vi.waitFor(() => expect(db.reserveModelCredits).toHaveBeenCalled());
  });

  it("sends plain HTTP in origin form without proxy headers", async () => {
    await start(false);
    const port = await forwarder(sealed());
    const answer = await exchange(
      port,
      "GET http://example.com/x?y=1 HTTP/1.1\r\nHost: example.com\r\nProxy-Connection: keep-alive\r\nAccept: */*\r\n\r\n",
      /Connection: close\r\n\r\n/,
    );
    expect(answer.startsWith("GET /x?y=1 HTTP/1.1")).toBe(true);
    expect(answer).not.toMatch(/proxy-connection/i);
    expect(answer).toContain("Accept: */*");
  });

  it("relays the gateway's refusals to the browser", async () => {
    await start(true);
    const port = await forwarder(sealed());
    const privateTarget = await exchange(port, "CONNECT 10.0.0.1:443 HTTP/1.1\r\n\r\n", /\r\n\r\n/);
    expect(privateTarget).toContain("403");
    db.reserveModelCredits.mockRejectedValue(new Error("Not enough model credits"));
    const broke = await exchange(port, "CONNECT example.com:443 HTTP/1.1\r\n\r\n", /used up/);
    expect(broke).toContain("402 Payment Required");
    expect(broke).toContain("X-Corvo-Egress-Error: EGRESS_CREDITS_USED_UP");
  });

  it("is refused with a forged capability", async () => {
    await start(true);
    const port = await forwarder(
      sealEgressCapability(egressCapabilityKey("other"), { botId: "bot-a", spaceId: "space" }),
    );
    const answer = await exchange(port, "CONNECT example.com:443 HTTP/1.1\r\n\r\n", /\r\n\r\n/);
    expect(answer).toMatch(/^HTTP\/1.1 502/);
    expect(provider.connections).toBe(0);
  });
});
