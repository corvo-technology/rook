import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { ImapFlow } from "imapflow";
import type { ParsedMail } from "mailparser";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import type {
  ImapSmtpAccount,
  Mailbox,
  MailMessage,
  MailSearch,
  MailSummary,
  OutgoingMail,
} from "./mailbox.js";
import { MAILBOX_LIMITS } from "./mailbox.js";
import type { MailHostPolicy } from "./mailbox-host.js";
import { resolveMailHost } from "./mailbox-host.js";
import { htmlToText, snippetOf } from "./mailbox-text.js";

const TIMEOUTS_MS = { connection: 10_000, greeting: 10_000, socket: 30_000 };

/** The part of an IMAP client this adapter uses, so tests can stand in for a server. */
export interface ImapClientLike {
  connect(): Promise<void>;
  logout(): Promise<void>;
  close(): void;
  getMailboxLock(path: string): Promise<{ release(): void }>;
  search(query: Record<string, unknown>, options: { uid: true }): Promise<number[] | false>;
  fetch(
    range: number[],
    query: Record<string, unknown>,
    options: { uid: true },
  ): AsyncIterable<ImapFetched>;
  fetchOne(
    uid: string,
    query: Record<string, unknown>,
    options: { uid: true },
  ): Promise<ImapFetched | false>;
  list(): Promise<Array<{ path: string; specialUse?: string }>>;
  append(path: string, content: Buffer, flags?: string[]): Promise<unknown>;
}

export interface ImapFetched {
  uid: number;
  flags?: Set<string>;
  internalDate?: Date | string;
  envelope?: { subject?: string; date?: Date };
  source?: Buffer;
}

export interface SmtpTransportLike {
  sendMail(message: {
    raw: Buffer;
    envelope: { from: string; to: string[] };
  }): Promise<{ messageId?: string }>;
  verify?(): Promise<unknown>;
  close?(): void;
}

export interface ImapSmtpDependencies extends MailHostPolicy {
  createImap?: (options: ImapConnection) => ImapClientLike;
  createSmtp?: (options: SmtpConnection) => SmtpTransportLike;
}

export interface ImapConnection {
  /** The validated address the socket dials. */
  host: string;
  /** The name the certificate must match. Unset for a literal address. */
  servername?: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}
export type SmtpConnection = ImapConnection;

function connectionFor(
  endpoint: { host: string; port: number; secure: boolean },
  resolved: string,
  account: ImapSmtpAccount,
): ImapConnection {
  return {
    host: resolved,
    servername: isIP(endpoint.host) ? undefined : endpoint.host,
    port: endpoint.port,
    secure: endpoint.secure,
    user: account.username,
    pass: account.password,
  };
}

function defaultImap(options: ImapConnection): ImapClientLike {
  return new ImapFlow({
    host: options.host,
    port: options.port,
    secure: options.secure,
    auth: { user: options.user, pass: options.pass },
    tls: options.servername ? { servername: options.servername } : {},
    logger: false,
    connectionTimeout: TIMEOUTS_MS.connection,
    greetingTimeout: TIMEOUTS_MS.greeting,
    socketTimeout: TIMEOUTS_MS.socket,
    disableAutoIdle: true,
  }) as unknown as ImapClientLike;
}

function defaultSmtp(options: ImapConnection): SmtpTransportLike {
  return nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    requireTLS: !options.secure,
    auth: { user: options.user, pass: options.pass },
    tls: options.servername ? { servername: options.servername } : {},
    connectionTimeout: TIMEOUTS_MS.connection,
    greetingTimeout: TIMEOUTS_MS.greeting,
    socketTimeout: TIMEOUTS_MS.socket,
    logger: false,
  }) as unknown as SmtpTransportLike;
}

export function encodeMailId(folder: string, uid: number): string {
  return `${folder}:${uid}`;
}

export function decodeMailId(id: string): { folder: string; uid: string } {
  const split = id.lastIndexOf(":");
  const uid = id.slice(split + 1);
  if (split <= 0 || !/^\d{1,12}$/.test(uid)) throw new Error("Unknown message id");
  return { folder: id.slice(0, split), uid };
}

function dateOnly(value: string | undefined, name: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${name} is not a valid date`);
  return date;
}

/** The IMAP search for these filters. Empty filters list the folder. */
export function imapQueryFor(search: MailSearch): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  if (search.unread === true) query.seen = false;
  if (search.unread === false) query.seen = true;
  if (search.from) query.from = search.from;
  const since = dateOnly(search.since, "since");
  const before = dateOnly(search.before, "before");
  if (since) query.since = since;
  if (before) query.before = before;
  if (search.query) query.text = search.query;
  return Object.keys(query).length > 0 ? query : { all: true };
}

function formatAddress(entry: { name?: string; address?: string }): string {
  if (!entry.address) return entry.name ?? "";
  return entry.name ? `${entry.name} <${entry.address}>` : entry.address;
}

function addressList(value: ParsedMail["to"]): string[] {
  const groups = value ? (Array.isArray(value) ? value : [value]) : [];
  return groups.flatMap((group) => group.value.map(formatAddress)).filter(Boolean);
}

function bodyText(parsed: ParsedMail): string {
  if (parsed.text?.trim()) return parsed.text;
  return typeof parsed.html === "string" ? htmlToText(parsed.html) : "";
}

function toIso(value: Date | string | undefined): string {
  const date = value ? new Date(value) : undefined;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
}

export async function summaryFromSource(
  folder: string,
  fetched: ImapFetched,
): Promise<MailSummary> {
  const parsed = await simpleParser(fetched.source ?? Buffer.alloc(0), {
    skipHtmlToText: true,
    skipImageLinks: true,
    skipTextToHtml: true,
    skipTextLinks: true,
  });
  return {
    id: encodeMailId(folder, fetched.uid),
    folder,
    subject: parsed.subject ?? fetched.envelope?.subject ?? "",
    from: addressList(parsed.from).join(", "),
    to: addressList(parsed.to),
    date: toIso(parsed.date ?? fetched.internalDate ?? fetched.envelope?.date),
    unread: !fetched.flags?.has("\\Seen"),
    snippet: snippetOf(bodyText(parsed)),
    hasAttachments: parsed.attachments.length > 0,
  };
}

export async function messageFromSource(
  folder: string,
  fetched: ImapFetched,
): Promise<MailMessage> {
  const parsed = await simpleParser(fetched.source ?? Buffer.alloc(0), {
    skipImageLinks: true,
    skipTextToHtml: true,
    skipTextLinks: true,
  });
  const references = Array.isArray(parsed.references)
    ? parsed.references
    : parsed.references
      ? [parsed.references]
      : [];
  return {
    ...(await summaryFromSource(folder, fetched)),
    cc: addressList(parsed.cc),
    text: bodyText(parsed),
    attachments: parsed.attachments.slice(0, MAILBOX_LIMITS.attachmentsListed).map((part) => ({
      name: part.filename ?? "attachment",
      contentType: part.contentType,
      size: part.size,
    })),
    messageId: parsed.messageId,
    references,
  };
}

function compose(account: ImapSmtpAccount, mail: OutgoingMail, messageId: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    new MailComposer({
      from: account.address,
      to: mail.to,
      cc: mail.cc,
      bcc: mail.bcc,
      subject: mail.subject,
      text: mail.text,
      messageId,
      inReplyTo: mail.inReplyTo,
      references: mail.references,
      // Never reveals the account's own client or host in a header.
      headers: { "X-Mailer": "Rook" },
    })
      .compile()
      .build((error, message) => (error ? reject(error) : resolve(message)));
  });
}

/** The IMAP/SMTP implementation of {@link Mailbox}. Each call opens and closes its own session. */
export class ImapSmtpMailbox implements Mailbox {
  constructor(
    private readonly account: ImapSmtpAccount,
    private readonly dependencies: ImapSmtpDependencies = {},
  ) {}

  private async withImap<T>(run: (client: ImapClientLike) => Promise<T>): Promise<T> {
    const address = await resolveMailHost(this.account.imap.host, this.dependencies);
    const client = (this.dependencies.createImap ?? defaultImap)(
      connectionFor(this.account.imap, address.address, this.account),
    );
    await client.connect();
    try {
      return await run(client);
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  private async withFolder<T>(
    client: ImapClientLike,
    folder: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const lock = await client.getMailboxLock(folder);
    try {
      return await run();
    } finally {
      lock.release();
    }
  }

  async search(search: MailSearch): Promise<MailSummary[]> {
    const folder = search.folder?.trim() || "INBOX";
    const limit = Math.min(Math.max(1, search.limit), MAILBOX_LIMITS.searchMax);
    return this.withImap((client) =>
      this.withFolder(client, folder, async () => {
        const found = await client.search(imapQueryFor(search), { uid: true });
        const newest = (found || []).slice(-limit);
        if (newest.length === 0) return [];
        const out: MailSummary[] = [];
        for await (const fetched of client.fetch(
          newest,
          { uid: true, flags: true, internalDate: true, source: { start: 0, maxLength: 16_384 } },
          { uid: true },
        )) {
          out.push(await summaryFromSource(folder, fetched));
        }
        return out.sort((a, b) => b.date.localeCompare(a.date));
      }),
    );
  }

  private async fetchMessage(
    client: ImapClientLike,
    folder: string,
    uid: string,
  ): Promise<MailMessage> {
    const fetched = await client.fetchOne(
      uid,
      {
        uid: true,
        flags: true,
        internalDate: true,
        source: { start: 0, maxLength: MAILBOX_LIMITS.sourceBytes },
      },
      { uid: true },
    );
    if (!fetched) throw new Error("Message not found");
    return messageFromSource(folder, fetched);
  }

  async read(id: string): Promise<MailMessage> {
    const { folder, uid } = decodeMailId(id);
    return this.withImap((client) =>
      this.withFolder(client, folder, () => this.fetchMessage(client, folder, uid)),
    );
  }

  async thread(id: string, limit: number): Promise<MailMessage[]> {
    const { folder, uid } = decodeMailId(id);
    return this.withImap((client) =>
      this.withFolder(client, folder, async () => {
        const first = await this.fetchMessage(client, folder, uid);
        const ids = new Set<number>([Number(uid)]);
        const searches: Record<string, unknown>[] = first.references
          .concat(first.messageId ? [first.messageId] : [])
          .flatMap((messageId) => [
            { header: { "message-id": messageId } },
            { header: { references: messageId } },
            { header: { "in-reply-to": messageId } },
          ]);
        for (const query of searches.slice(0, 12)) {
          for (const found of (await client.search(query, { uid: true })) || []) ids.add(found);
        }
        const chosen = [...ids].sort((a, b) => a - b).slice(-limit);
        const messages: MailMessage[] = [];
        for (const wanted of chosen) {
          messages.push(
            wanted === Number(uid)
              ? first
              : await this.fetchMessage(client, folder, String(wanted)),
          );
        }
        return messages.sort((a, b) => a.date.localeCompare(b.date));
      }),
    );
  }

  private async special(client: ImapClientLike, use: string, fallback: RegExp): Promise<string> {
    const folders = await client.list();
    const found =
      folders.find((entry) => entry.specialUse === use) ??
      folders.find((entry) => fallback.test(entry.path));
    if (!found) throw new Error(`This mailbox has no ${use.replace("\\", "")} folder`);
    return found.path;
  }

  async saveDraft(mail: OutgoingMail): Promise<{ id?: string }> {
    const raw = await compose(this.account, mail, `<${randomUUID()}@${this.domain()}>`);
    return this.withImap(async (client) => {
      const folder = await this.special(client, "\\Drafts", /^drafts?$/i);
      await client.append(folder, raw, ["\\Draft", "\\Seen"]);
      return { id: folder };
    });
  }

  async send(mail: OutgoingMail): Promise<{ messageId: string }> {
    const messageId = `<${randomUUID()}@${this.domain()}>`;
    const raw = await compose(this.account, mail, messageId);
    const address = await resolveMailHost(this.account.smtp.host, this.dependencies);
    const transport = (this.dependencies.createSmtp ?? defaultSmtp)(
      connectionFor(this.account.smtp, address.address, this.account),
    );
    try {
      await transport.sendMail({
        raw,
        envelope: {
          from: this.account.address,
          to: [...mail.to, ...mail.cc, ...mail.bcc],
        },
      });
    } finally {
      transport.close?.();
    }
    return { messageId };
  }

  private domain(): string {
    return this.account.address.split("@")[1] ?? "localhost";
  }

  async verify(): Promise<void> {
    await this.withImap(async () => undefined);
    const address = await resolveMailHost(this.account.smtp.host, this.dependencies);
    const transport = (this.dependencies.createSmtp ?? defaultSmtp)(
      connectionFor(this.account.smtp, address.address, this.account),
    );
    try {
      await transport.verify?.();
    } finally {
      transport.close?.();
    }
  }

  async close(): Promise<void> {}
}
