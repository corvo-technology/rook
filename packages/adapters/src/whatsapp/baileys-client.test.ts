import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BaileysDeps, type BaileysSocketLike, createBaileysClient } from "./baileys-client.js";
import type { WhatsAppConnectionEvent, WhatsAppIncoming } from "./client.js";
import { MemoryWhatsAppAuthStore } from "./scripted-client.js";

type Handler = (payload: never) => void;

class FakeSocket implements BaileysSocketLike {
  handlers = new Map<string, Handler>();
  user: { id: string; lid?: string } | undefined = {
    id: "15550001:3@s.whatsapp.net",
    lid: "99900001@lid",
  };
  sent: Array<{ jid: string; content: unknown }> = [];
  presence: Array<{ state: string; jid: string }> = [];
  readKeys: unknown[] = [];
  loggedOut = false;
  ended = false;
  ev = { on: (event: string, handler: Handler) => void this.handlers.set(event, handler) };
  emit(event: string, payload: unknown) {
    this.handlers.get(event)?.(payload as never);
  }
  async sendMessage(jid: string, content: unknown) {
    this.sent.push({ jid, content });
    return { key: { id: `sent-${this.sent.length}` } };
  }
  async sendPresenceUpdate(state: string, jid: string) {
    this.presence.push({ state, jid });
  }
  async readMessages(keys: unknown[]) {
    this.readKeys.push(...keys);
  }
  async logout() {
    this.loggedOut = true;
  }
  end() {
    this.ended = true;
  }
}

function setup(options: { failSaveCreds?: boolean; failSocketAfter?: number } = {}) {
  const sockets: FakeSocket[] = [];
  let made = 0;
  const deps: BaileysDeps = {
    makeSocket: () => {
      made += 1;
      if (options.failSocketAfter !== undefined && made > options.failSocketAfter) {
        throw new Error("could not open a socket");
      }
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    downloadMedia: async () => new Uint8Array([9]),
    loadAuth: async () =>
      ({
        saveCreds: async () => {
          if (options.failSaveCreds) throw new Error("secret store timed out");
        },
      }) as never,
    // Logged out, forbidden (banned), multi-device mismatch: nothing to reconnect.
    terminalCodes: [401, 403, 411],
    replacedCode: 440,
    restartRequiredCode: 515,
  };
  const client = createBaileysClient(new MemoryWhatsAppAuthStore(), deps);
  const events: WhatsAppConnectionEvent[] = [];
  const messages: WhatsAppIncoming[] = [];
  client.onConnection((event) => events.push(event));
  client.onMessage((message) => messages.push(message));
  return { client, sockets, events, messages };
}

const closeWith = (socket: FakeSocket, statusCode: number) =>
  socket.emit("connection.update", {
    connection: "close",
    lastDisconnect: { error: { output: { statusCode } } },
  });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createBaileysClient", () => {
  it("reports the QR and the linked number", async () => {
    const { client, sockets, events } = setup();
    await client.connect();
    sockets[0]?.emit("connection.update", { qr: "qr-string" });
    sockets[0]?.emit("connection.update", { connection: "open" });
    expect(events).toEqual([
      { state: "qr", qr: "qr-string" },
      { state: "open", number: "+15550001" },
    ]);
  });

  it("ends the session when WhatsApp logs the device out, and never reconnects", async () => {
    const { client, sockets, events } = setup();
    await client.connect();
    closeWith(sockets[0] as FakeSocket, 401);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(events).toEqual([{ state: "closed", reason: "logged-out" }]);
    expect(sockets).toHaveLength(1);
  });

  it("does not reconnect when another device replaced this one", async () => {
    const { client, sockets, events } = setup();
    await client.connect();
    closeWith(sockets[0] as FakeSocket, 440);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(events).toEqual([{ state: "closed", reason: "replaced" }]);
    expect(sockets).toHaveLength(1);
  });

  it("reconnects at once after pairing asks for a restart, without reporting a close", async () => {
    const { client, sockets, events } = setup();
    await client.connect();
    closeWith(sockets[0] as FakeSocket, 515);
    await vi.advanceTimersByTimeAsync(10);
    expect(sockets).toHaveLength(2);
    expect(events).toEqual([]);
  });

  it("reconnects after an unexplained stream error, which WhatsApp reports as a bad session", async () => {
    const { client, sockets, events } = setup();
    await client.connect();
    closeWith(sockets[0] as FakeSocket, 500);
    expect(events).toEqual([{ state: "closed", reason: "network" }]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sockets).toHaveLength(2);
  });

  it("reconnects after a network close with a growing wait, and reports it", async () => {
    const { client, sockets, events } = setup();
    await client.connect();
    closeWith(sockets[0] as FakeSocket, 408);
    expect(events).toEqual([{ state: "closed", reason: "network" }]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sockets).toHaveLength(2);
    closeWith(sockets[1] as FakeSocket, 408);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sockets).toHaveLength(3);
  });

  it("does not reconnect after the caller closed it", async () => {
    const { client, sockets } = setup();
    await client.connect();
    await client.close();
    closeWith(sockets[0] as FakeSocket, 408);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.ended).toBe(true);
  });

  it("marks replayed history and keeps live messages live", async () => {
    const { client, sockets, messages } = setup();
    await client.connect();
    const make = (id: string) => ({
      key: { remoteJid: "15550100@s.whatsapp.net", fromMe: false, id },
      message: { conversation: id },
      messageTimestamp: 1,
    });
    sockets[0]?.emit("messages.upsert", { type: "notify", messages: [make("live")] });
    sockets[0]?.emit("messages.upsert", { type: "append", messages: [make("late")] });
    sockets[0]?.emit("messaging-history.set", { messages: [make("old")] });
    expect(messages.map((m) => [m.messageId, m.history])).toEqual([
      ["live", false],
      ["late", true],
      ["old", true],
    ]);
  });

  it("recognizes the self chat from the account's own ids", async () => {
    const { client, sockets, messages } = setup();
    await client.connect();
    sockets[0]?.emit("messages.upsert", {
      type: "notify",
      messages: [
        {
          key: { remoteJid: "99900001@lid", fromMe: true, id: "s1" },
          message: { conversation: "note" },
          messageTimestamp: 1,
        },
      ],
    });
    expect(messages[0]?.chat.kind).toBe("self");
  });

  it("sends text, typing and read receipts through the socket, and logs out", async () => {
    const { client, sockets } = setup();
    await client.connect();
    const socket = sockets[0] as FakeSocket;
    expect(await client.sendText("c1", "hi")).toEqual({ id: "sent-1" });
    await client.setTyping("c1", true);
    await client.setTyping("c1", false);
    await client.markRead("c1", "m1");
    await client.logout();
    expect(socket.sent).toEqual([{ jid: "c1", content: { text: "hi" } }]);
    expect(socket.presence).toEqual([
      { state: "composing", jid: "c1" },
      { state: "paused", jid: "c1" },
    ]);
    expect(socket.readKeys).toEqual([{ remoteJid: "c1", id: "m1", fromMe: false }]);
    expect(socket.loggedOut).toBe(true);
  });
});

describe("createBaileysClient: failures that must not take the process down", () => {
  it("survives a session save that fails", async () => {
    const { client, sockets } = setup({ failSaveCreds: true });
    await client.connect();
    sockets[0]?.emit("creds.update", {});
    await vi.advanceTimersByTimeAsync(10);
    // Reaching here without an unhandled rejection is the assertion.
    expect(sockets).toHaveLength(1);
  });

  it("survives a reconnect that cannot open a socket, and tries again", async () => {
    const { client, sockets } = setup({ failSocketAfter: 1 });
    await client.connect();
    closeWith(sockets[0] as FakeSocket, 500 + 1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
  });

  it("treats a ban and a multi-device mismatch like a logout, with no reconnect", async () => {
    for (const code of [403, 411]) {
      const { client, sockets, events } = setup();
      await client.connect();
      closeWith(sockets[0] as FakeSocket, code);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(events).toEqual([{ state: "closed", reason: "logged-out" }]);
      expect(sockets).toHaveLength(1);
    }
  });
});
