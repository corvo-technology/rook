/**
 * What an agent can do with an email account, independent of the protocol behind it. IMAP/SMTP is
 * the first implementation; a Gmail or Outlook API adapter implements the same interface.
 */
export interface MailSummary {
  /** Opaque to callers; the adapter decides how it addresses a message. */
  id: string;
  folder: string;
  subject: string;
  from: string;
  to: string[];
  date: string;
  unread: boolean;
  snippet: string;
  hasAttachments: boolean;
}

export interface MailAttachment {
  name: string;
  contentType: string;
  size: number;
}

export interface MailMessage extends MailSummary {
  cc: string[];
  /** Plain text. HTML mail is converted; nothing is executed or fetched. */
  text: string;
  attachments: MailAttachment[];
  /** The Message-ID header, for threading a reply. */
  messageId?: string;
  references: string[];
}

export interface MailSearch {
  folder?: string;
  unread?: boolean;
  from?: string;
  /** ISO date; messages on or after it. */
  since?: string;
  /** ISO date; messages before it. */
  before?: string;
  /** Free text matched against the message. */
  query?: string;
  limit: number;
}

export interface OutgoingMail {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
}

export interface Mailbox {
  /** Signs in to the account's servers; throws when they refuse it. */
  verify(): Promise<void>;
  /** Newest first. */
  search(search: MailSearch): Promise<MailSummary[]>;
  read(id: string): Promise<MailMessage>;
  /** The conversation the message belongs to, oldest first. */
  thread(id: string, limit: number): Promise<MailMessage[]>;
  /** Saves a draft in the account, where the provider supports drafts. */
  saveDraft(mail: OutgoingMail): Promise<{ id?: string }>;
  /** Hands the message to the mail server once. Never retries. */
  send(mail: OutgoingMail): Promise<{ messageId: string }>;
  close(): Promise<void>;
}

export interface ImapSmtpAccount {
  address: string;
  username: string;
  password: string;
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean };
}

/** Limits that keep one tool call small and one agent from flooding an inbox. */
export const MAILBOX_LIMITS = {
  searchDefault: 10,
  searchMax: 25,
  snippetChars: 200,
  fieldChars: 300,
  bodyChars: 20_000,
  threadMessages: 10,
  threadChars: 40_000,
  attachmentsListed: 20,
  recipients: 20,
  subjectChars: 300,
  outgoingBodyChars: 50_000,
  sendsPerHour: 20,
  /** Largest raw message the adapter parses. */
  sourceBytes: 2_000_000,
} as const;
