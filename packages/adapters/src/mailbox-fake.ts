import type { Mailbox, MailMessage, MailSearch, MailSummary, OutgoingMail } from "./mailbox.js";

/** An in-memory account: what the connector and its tests run against instead of a server. */
export class FakeMailbox implements Mailbox {
  readonly drafts: OutgoingMail[] = [];
  readonly sent: OutgoingMail[] = [];
  searches: MailSearch[] = [];
  failSendWith: Error | undefined;

  constructor(readonly messages: MailMessage[] = []) {}

  async verify(): Promise<void> {}

  async search(search: MailSearch): Promise<MailSummary[]> {
    this.searches.push(search);
    const needle = search.query?.toLowerCase();
    return this.messages
      .filter((message) => message.folder === (search.folder ?? "INBOX"))
      .filter((message) => search.unread === undefined || message.unread === search.unread)
      .filter(
        (message) => !search.from || message.from.toLowerCase().includes(search.from.toLowerCase()),
      )
      .filter((message) => !search.since || message.date >= search.since)
      .filter((message) => !search.before || message.date < search.before)
      .filter(
        (message) => !needle || `${message.subject} ${message.text}`.toLowerCase().includes(needle),
      )
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, search.limit);
  }

  async read(id: string): Promise<MailMessage> {
    const found = this.messages.find((message) => message.id === id);
    if (!found) throw new Error("Message not found");
    return found;
  }

  async thread(id: string, limit: number): Promise<MailMessage[]> {
    const first = await this.read(id);
    const related = this.messages.filter(
      (message) =>
        message.id === id ||
        (first.messageId && message.references.includes(first.messageId)) ||
        (message.messageId && first.references.includes(message.messageId)),
    );
    return related.sort((a, b) => a.date.localeCompare(b.date)).slice(-limit);
  }

  async saveDraft(mail: OutgoingMail): Promise<{ id?: string }> {
    this.drafts.push(mail);
    return { id: "Drafts" };
  }

  async send(mail: OutgoingMail): Promise<{ messageId: string }> {
    if (this.failSendWith) throw this.failSendWith;
    this.sent.push(mail);
    return { messageId: `<sent-${this.sent.length}@fake.test>` };
  }

  async close(): Promise<void> {}
}
