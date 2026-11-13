import { getLogger } from "@corvo/logging";
import type {
  WhatsAppAuthStore,
  WhatsAppConnectionEvent,
  WhatsAppIncoming,
  WhatsAppLinkClient,
} from "./client.js";
import { mapIncoming, type RawWhatsAppMessage } from "./map-message.js";

/**
 * The only file that knows the WhatsApp Web library (Baileys, pinned in package.json). It is
 * loaded on first use, so a process with no linked number never pays for it.
 */

type Handler = (payload: never) => void;

export interface BaileysSocketLike {
  ev: { on(event: string, handler: Handler): unknown };
  user?: { id: string; lid?: string } | undefined;
  sendMessage(
    jid: string,
    content: { text: string },
  ): Promise<{ key?: { id?: string | null } } | undefined>;
  sendPresenceUpdate(state: "composing" | "paused", jid: string): Promise<void>;
  readMessages(keys: Array<{ remoteJid: string; id: string; fromMe: boolean }>): Promise<unknown>;
  logout(): Promise<void>;
  end(error: Error | undefined): void;
}

export interface BaileysDeps {
  makeSocket(config: Record<string, unknown>): BaileysSocketLike;
  downloadMedia(raw: RawWhatsAppMessage): Promise<Uint8Array>;
  loadAuth(store: WhatsAppAuthStore): Promise<{ state: unknown; saveCreds(): Promise<void> }>;
  /** Close codes after which the session cannot continue: logged out, banned, bad session. */
  terminalCodes: readonly number[];
  replacedCode: number;
  restartRequiredCode: number;
}

const SILENT_LOGGER = {
  level: "silent",
  child() {
    return SILENT_LOGGER;
  },
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const MAX_BACKOFF_MS = 60_000;

/** A Baileys client for one linked number, with its session in `auth`. */
export function createBaileysClient(
  auth: WhatsAppAuthStore,
  deps?: BaileysDeps,
): WhatsAppLinkClient {
  let resolved: Promise<BaileysDeps> | undefined;
  const dependencies = () => {
    resolved ??= deps ? Promise.resolve(deps) : loadBaileysDeps();
    return resolved;
  };
  const connectionListeners: Array<(event: WhatsAppConnectionEvent) => void> = [];
  const messageListeners: Array<(message: WhatsAppIncoming) => void> = [];
  let socket: BaileysSocketLike | undefined;
  let stopped = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const emitConnection = (event: WhatsAppConnectionEvent) => {
    for (const listener of connectionListeners) listener(event);
  };

  const ownIds = (current: BaileysSocketLike) =>
    [current.user?.id, current.user?.lid].filter((id): id is string => Boolean(id));

  /** A reconnect that cannot even open a socket is tried again later, never thrown. */
  function startFailed(error: unknown) {
    getLogger().warn("whatsapp reconnect failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    if (!stopped) scheduleReconnect();
  }

  function scheduleReconnect() {
    attempts += 1;
    const wait = Math.min(2_000 * 2 ** (attempts - 1), MAX_BACKOFF_MS);
    timer = setTimeout(() => {
      if (!stopped) start().catch(startFailed);
    }, wait);
  }

  async function start(): Promise<void> {
    const lib = await dependencies();
    const { state, saveCreds } = await lib.loadAuth(auth);
    const current = lib.makeSocket({
      auth: state,
      printQRInTerminal: false,
      logger: SILENT_LOGGER,
      browser: ["Rook", "Desktop", "1.0"],
      // Keep the phone's own notifications, and skip the full history sync.
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    socket = current;
    current.ev.on("creds.update", (() => {
      // A failed save must never take the process down; the next update saves it again.
      saveCreds().catch((error: unknown) => {
        getLogger().warn("whatsapp session could not be saved", {
          reason: error instanceof Error ? error.message : String(error),
        });
      });
    }) as Handler);
    current.ev.on("connection.update", ((update: {
      qr?: string;
      connection?: string;
      lastDisconnect?: { error?: { output?: { statusCode?: number } } };
    }) => {
      if (update.qr) emitConnection({ state: "qr", qr: update.qr });
      if (update.connection === "open") {
        attempts = 0;
        const user = current.user?.id.split("@")[0]?.split(":")[0] ?? "";
        emitConnection({ state: "open", number: `+${user}` });
      }
      if (update.connection !== "close" || stopped) return;
      const code = update.lastDisconnect?.error?.output?.statusCode;
      getLogger().warn("whatsapp connection closed", { code });
      if (code !== undefined && lib.terminalCodes.includes(code)) {
        stopped = true;
        emitConnection({ state: "closed", reason: "logged-out" });
      } else if (code === lib.replacedCode) {
        stopped = true;
        emitConnection({ state: "closed", reason: "replaced" });
      } else if (code === lib.restartRequiredCode) {
        // Normal right after pairing: open a fresh socket at once.
        start().catch(startFailed);
      } else {
        emitConnection({ state: "closed", reason: "network" });
        scheduleReconnect();
      }
    }) as Handler);
    const deliver = (messages: RawWhatsAppMessage[], history: boolean) => {
      for (const raw of messages) {
        const mapped = mapIncoming(raw, {
          ownIds: ownIds(current),
          history,
          download: lib.downloadMedia,
        });
        if (mapped) for (const listener of messageListeners) listener(mapped);
      }
    };
    current.ev.on("messages.upsert", ((payload: { type: string; messages: RawWhatsAppMessage[] }) =>
      deliver(payload.messages, payload.type !== "notify")) as Handler);
    current.ev.on("messaging-history.set", ((payload: { messages?: RawWhatsAppMessage[] }) =>
      deliver(payload.messages ?? [], true)) as Handler);
  }

  const active = () => {
    if (!socket) throw new Error("WhatsApp is not connected");
    return socket;
  };

  return {
    async connect() {
      stopped = false;
      await start();
    },
    onConnection: (callback) => void connectionListeners.push(callback),
    onMessage: (callback) => void messageListeners.push(callback),
    async sendText(chatId, text) {
      const sent = await active().sendMessage(chatId, { text });
      return { id: sent?.key?.id ?? "" };
    },
    async setTyping(chatId, on) {
      await active().sendPresenceUpdate(on ? "composing" : "paused", chatId);
    },
    async markRead(chatId, messageId) {
      await active().readMessages([{ remoteJid: chatId, id: messageId, fromMe: false }]);
    },
    async logout() {
      stopped = true;
      if (timer) clearTimeout(timer);
      try {
        await active().logout();
      } finally {
        await auth.clear();
      }
    },
    async close() {
      stopped = true;
      if (timer) clearTimeout(timer);
      socket?.end(undefined);
    },
  };
}

/** Loads the library and adapts its auth state to the store the surface gives each number. */
async function loadBaileysDeps(): Promise<BaileysDeps> {
  const lib = await import("@whiskeysockets/baileys");
  const make = (lib.default ??
    (lib as unknown as { makeWASocket: unknown }).makeWASocket) as unknown as (
    config: Record<string, unknown>,
  ) => BaileysSocketLike;
  return {
    makeSocket: (config) => make(config),
    downloadMedia: async (raw) =>
      new Uint8Array(
        (await lib.downloadMediaMessage(raw as never, "buffer", {})) as unknown as ArrayBuffer,
      ),
    loadAuth: async (store) => {
      const { BufferJSON, initAuthCreds, proto } = lib;
      const stored = await store.get("creds");
      const creds = stored ? JSON.parse(stored, BufferJSON.reviver) : initAuthCreds();
      return {
        state: {
          creds,
          keys: {
            get: async (type: string, ids: string[]) => {
              const found: Record<string, unknown> = {};
              await Promise.all(
                ids.map(async (id) => {
                  const value = await store.get(`${type}-${id}`);
                  if (!value) return;
                  const parsed = JSON.parse(value, BufferJSON.reviver);
                  found[id] =
                    type === "app-state-sync-key"
                      ? proto.Message.AppStateSyncKeyData.fromObject(parsed)
                      : parsed;
                }),
              );
              return found;
            },
            set: async (data: Record<string, Record<string, unknown>>) => {
              for (const [type, entries] of Object.entries(data)) {
                for (const [id, value] of Object.entries(entries)) {
                  await store.set(
                    `${type}-${id}`,
                    value ? JSON.stringify(value, BufferJSON.replacer) : undefined,
                  );
                }
              }
            },
          },
        },
        saveCreds: () => store.set("creds", JSON.stringify(creds, BufferJSON.replacer)),
      };
    },
    // Not badSession: Baileys gives that code to every stream error it cannot name, which a
    // reconnect recovers from. Ending the session there unlinks a number mid-conversation.
    terminalCodes: [
      lib.DisconnectReason.loggedOut,
      lib.DisconnectReason.forbidden,
      lib.DisconnectReason.multideviceMismatch,
    ],
    replacedCode: lib.DisconnectReason.connectionReplaced,
    restartRequiredCode: lib.DisconnectReason.restartRequired,
  };
}
