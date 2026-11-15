import { z } from "zod";
import { Id } from "./ids.js";

const MailServer = z.object({
  host: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^[A-Za-z0-9.:[\]-]+$/, "Enter a host name without a path"),
  port: z.number().int().min(1).max(65535),
  /** Implicit TLS. Otherwise the connection upgrades with STARTTLS and never stays plain. */
  secure: z.boolean(),
});

/** What is stored in the clear for a mailbox. The password lives in the secret store. */
export const MailboxConfigSchema = z.object({
  imap: MailServer,
  smtp: MailServer,
  username: z.string().trim().min(1).max(320),
});
export type MailboxConfig = z.infer<typeof MailboxConfigSchema>;

export const MailboxInput = z.object({
  address: z.string().trim().email().max(320),
  password: z.string().min(1).max(512),
  ...MailboxConfigSchema.shape,
});
export type MailboxInputValue = z.infer<typeof MailboxInput>;

export const MailboxSchema = z.object({
  id: Id,
  address: z.string(),
  imap: MailServer,
  smtp: MailServer,
  username: z.string(),
  /** Agents allowed to use this mailbox. */
  botIds: z.array(Id),
  createdAt: z.string(),
});
export type MailboxDto = z.infer<typeof MailboxSchema>;
