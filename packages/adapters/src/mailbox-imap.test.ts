import { describe, expect, it } from "vitest";
import type { ImapSmtpAccount } from "./mailbox.js";
import type { ImapClientLike, ImapFetched, SmtpTransportLike } from "./mailbox-imap.js";
import { decodeMailId, ImapSmtpMailbox, imapQueryFor } from "./mailbox-imap.js";

const account: ImapSmtpAccount = {
  address: "owner@example.test",
  username: "owner",
  password: "app-password-123",
  imap: { host: "imap.example.test", port: 993, secure: true },
  smtp: { host: "smtp.example.test", port: 465, secure: true },
};
const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];

const plain = [
  "From: Ana <ana@sender.test>",
  "To: owner@example.test",
  "Subject: Lunch?",
  "Date: Tue, 03 Nov 2026 10:00:00 +0000",
  "Message-ID: <m1@sender.test>",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Are you free at noon?",
].join("\r\n");

const htmlWithAttachment = [
  "From: Shop <shop@sender.test>",
  "To: owner@example.test",
  "Cc: boss@example.test",
  "Subject: Your invoice",
  "Date: Wed, 04 Nov 2026 09:00:00 +0000",
  "Message-ID: <m2@sender.test>",
  "References: <m1@sender.test>",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="b1"',
  "",
  "--b1",
  "Content-Type: text/html; charset=utf-8",
  "",
  "<p>Total: <b>$10</b></p><script>steal()</script>",
  "--b1",
  'Content-Type: application/pdf; name="invoice.pdf"',
  'Content-Disposition: attachment; filename="invoice.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("%PDF-1.4 fake").toString("base64"),
  "--b1--",
  "",
].join("\r\n");

type Folder = Record<number, { raw: string; flags: string[] }>;

function fakeImap(folders: Record<string, Folder>, log: string[] = []) {
  const appended: Array<{ path: string; flags?: string[]; raw: string }> = [];
  let open = "";
  const client: ImapClientLike = {
    async connect() {
      log.push("connect");
    },
    async logout() {
      log.push("logout");
    },
    close() {},
    async getMailboxLock(path) {
      open = path;
      log.push(`lock:${path}`);
      return { release: () => log.push("release") };
    },
    async search(query) {
      log.push(`search:${JSON.stringify(query)}`);
      return Object.keys(folders[open] ?? {}).map(Number);
    },
    async *fetch(range) {
      for (const uid of range) yield fetched(uid);
    },
    async fetchOne(uid) {
      return folders[open]?.[Number(uid)] ? fetched(Number(uid)) : false;
    },
    async list() {
      return [
        { path: "INBOX" },
        { path: "Entwürfe", specialUse: "\\Drafts" },
        { path: "Sent", specialUse: "\\Sent" },
      ];
    },
    async append(path, content, flags) {
      appended.push({ path, flags, raw: content.toString() });
    },
  };
  function fetched(uid: number): ImapFetched {
    const entry = folders[open]![uid]!;
    return { uid, flags: new Set(entry.flags), source: Buffer.from(entry.raw) };
  }
  return { client, appended, log };
}

describe("imapQueryFor", () => {
  it("maps each filter to an IMAP search key", () => {
    expect(
      imapQueryFor({
        unread: true,
        from: "ana@x.test",
        since: "2026-11-01",
        query: "invoice",
        limit: 5,
      }),
    ).toEqual({
      seen: false,
      from: "ana@x.test",
      since: new Date("2026-11-01"),
      text: "invoice",
    });
    expect(imapQueryFor({ unread: false, limit: 5 })).toEqual({ seen: true });
    expect(imapQueryFor({ limit: 5 })).toEqual({ all: true });
  });

  it("refuses a date it cannot read", () => {
    expect(() => imapQueryFor({ since: "yesterday-ish", limit: 5 })).toThrow(/since/);
  });
});

describe("message ids", () => {
  it("round-trips a folder and uid and rejects anything else", () => {
    expect(decodeMailId("INBOX:42")).toEqual({ folder: "INBOX", uid: "42" });
    expect(decodeMailId("Archive:2026:7")).toEqual({ folder: "Archive:2026", uid: "7" });
    for (const bad of ["42", "INBOX:", "INBOX:abc", ":5", "INBOX:1 OR ALL"])
      expect(() => decodeMailId(bad)).toThrow(/Unknown message id/);
  });
});

describe("ImapSmtpMailbox", () => {
  const folders = (): Record<string, Folder> => ({
    INBOX: {
      1: { raw: plain, flags: ["\\Seen"] },
      2: { raw: htmlWithAttachment, flags: [] },
    },
  });
  const make = (imap: ReturnType<typeof fakeImap>, smtp?: SmtpTransportLike) =>
    new ImapSmtpMailbox(account, {
      resolveHostname: publicDns,
      createImap: () => imap.client,
      createSmtp: () => smtp ?? { sendMail: async () => ({}) },
    });

  it("lists the newest messages with unread state, snippet and attachment flag", async () => {
    const imap = fakeImap(folders());
    const result = await make(imap).search({ limit: 10 });
    expect(result.map((message) => message.id)).toEqual(["INBOX:2", "INBOX:1"]);
    expect(result[0]).toMatchObject({
      subject: "Your invoice",
      from: "Shop <shop@sender.test>",
      unread: true,
      hasAttachments: true,
      date: "2026-11-04T09:00:00.000Z",
    });
    expect(result[0]!.snippet).toBe("Total: $10");
    expect(result[1]).toMatchObject({ subject: "Lunch?", unread: false, hasAttachments: false });
    expect(imap.log).toContain("lock:INBOX");
    expect(imap.log.at(-1)).toBe("logout");
    expect(imap.log.filter((entry) => entry === "release")).toHaveLength(1);
  });

  it("passes the filters to the server and respects the limit", async () => {
    const imap = fakeImap(folders());
    const result = await make(imap).search({ unread: true, query: "invoice", limit: 1 });
    expect(imap.log.find((entry) => entry.startsWith("search:"))).toBe(
      `search:${JSON.stringify({ seen: false, text: "invoice" })}`,
    );
    expect(result).toHaveLength(1);
  });

  it("reads a message as clean text, lists attachments and never marks it read", async () => {
    const imap = fakeImap(folders());
    const message = await make(imap).read("INBOX:2");
    expect(message.text).toContain("Total: $10");
    expect(message.text).not.toMatch(/<|steal/);
    expect(message.cc).toEqual(["boss@example.test"]);
    expect(message.attachments).toEqual([
      { name: "invoice.pdf", contentType: "application/pdf", size: expect.any(Number) },
    ]);
    expect(message.references).toEqual(["<m1@sender.test>"]);
    await expect(make(imap).read("INBOX:99")).rejects.toThrow(/not found/i);
  });

  it("builds a thread from the references", async () => {
    const imap = fakeImap(folders());
    const thread = await make(imap).thread("INBOX:2", 10);
    expect(thread.map((message) => message.id)).toEqual(["INBOX:1", "INBOX:2"]);
  });

  it("saves a draft in the account's Drafts folder without sending", async () => {
    const imap = fakeImap(folders());
    const sent: unknown[] = [];
    const mailbox = make(imap, { sendMail: async (message) => (sent.push(message), {}) });
    await mailbox.saveDraft({
      to: ["ana@sender.test"],
      cc: [],
      bcc: [],
      subject: "Re: Lunch?",
      text: "Noon works.",
      inReplyTo: "<m1@sender.test>",
    });
    expect(sent).toHaveLength(0);
    expect(imap.appended).toHaveLength(1);
    expect(imap.appended[0]!.path).toBe("Entwürfe");
    expect(imap.appended[0]!.flags).toContain("\\Draft");
    expect(imap.appended[0]!.raw).toContain("In-Reply-To: <m1@sender.test>");
    expect(imap.appended[0]!.raw).toContain("Noon works.");
  });

  it("sends once through SMTP with bcc kept out of the headers", async () => {
    const imap = fakeImap(folders());
    const sent: Array<{ raw: Buffer; envelope: { from: string; to: string[] } }> = [];
    const mailbox = make(imap, { sendMail: async (message) => (sent.push(message), {}) });
    const result = await mailbox.send({
      to: ["ana@sender.test"],
      cc: ["boss@example.test"],
      bcc: ["secret@example.test"],
      subject: "Hi",
      text: "Hello",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.envelope).toEqual({
      from: "owner@example.test",
      to: ["ana@sender.test", "boss@example.test", "secret@example.test"],
    });
    const raw = sent[0]!.raw.toString();
    expect(raw).toContain("To: ana@sender.test");
    expect(raw).toContain("Cc: boss@example.test");
    expect(raw).not.toContain("secret@example.test");
    expect(raw).toContain(`Message-ID: ${result.messageId}`);
  });

  it("does not put a header injected through the subject into the message", async () => {
    const imap = fakeImap(folders());
    const sent: Array<{ raw: Buffer }> = [];
    const mailbox = make(imap, { sendMail: async (message) => (sent.push(message), {}) });
    await mailbox.send({
      to: ["ana@sender.test"],
      cc: [],
      bcc: [],
      subject: "Hi\r\nBcc: evil@x.test",
      text: "Hello",
    });
    const headers = sent[0]!.raw.toString().split("\r\n\r\n")[0]!;
    expect(headers).not.toMatch(/^Bcc:/im);
  });

  it("dials the validated address, with the host name kept for the certificate", async () => {
    const seen: Array<{ host: string; servername?: string }> = [];
    const imap = fakeImap(folders());
    const mailbox = new ImapSmtpMailbox(account, {
      resolveHostname: publicDns,
      createImap: (options) => (seen.push(options), imap.client),
    });
    await mailbox.search({ limit: 1 });
    expect(seen[0]).toMatchObject({ host: "93.184.216.34", servername: "imap.example.test" });
  });

  it("never connects to a private mail server", async () => {
    const imap = fakeImap(folders());
    const mailbox = new ImapSmtpMailbox(
      { ...account, imap: { host: "10.0.0.7", port: 993, secure: true } },
      { createImap: () => imap.client },
    );
    await expect(mailbox.search({ limit: 1 })).rejects.toThrow(/private/i);
    expect(imap.log).not.toContain("connect");
  });
});
