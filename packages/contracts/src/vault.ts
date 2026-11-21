import { z } from "zod";
import {
  BOT_SECRET_VALUE_MAX_LENGTH,
  BotSecretAuth,
  BotSecretDestinationInput,
  StoredBotSecretName,
} from "./bot-secrets.js";
import { Id } from "./ids.js";

/** Who may use a credential: runs for its owner only, or runs for any member of the space. */
export const VaultScope = z.enum(["personal", "space"]);
export type VaultScope = z.infer<typeof VaultScope>;

/**
 * A credential as the Vault lists it. Never the value, and no hint of it: the first or last
 * characters of a secret are part of it.
 */
export const VaultCredentialSchema = z.object({
  id: Id,
  name: StoredBotSecretName,
  origin: z.string(),
  /** Null when the stored settings can't be read, so the row stays removable. */
  auth: BotSecretAuth.nullable(),
  scope: VaultScope,
  /** Whether the person asking owns it. */
  mine: z.boolean(),
  /** Whether the person asking may replace it, remove it and change which agents use it. */
  canManage: z.boolean(),
  /** The agents that may use it. */
  botIds: z.array(Id),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type VaultCredential = z.infer<typeof VaultCredentialSchema>;

export const VaultCreateInput = z.object({
  destination: BotSecretDestinationInput,
  value: z.string().min(1).max(BOT_SECRET_VALUE_MAX_LENGTH),
  scope: VaultScope.default("personal"),
  botIds: z.array(Id).max(200).default([]),
});
export type VaultCreateInput = z.input<typeof VaultCreateInput>;

/** One use of a credential. The destination is an origin, or "command" or "browser". */
export const VaultUseSchema = z.object({
  id: Id,
  botId: Id.nullable(),
  runId: z.string().nullable(),
  /** Whom the run acted for. */
  forName: z.string().nullable(),
  forMe: z.boolean(),
  destination: z.string(),
  outcome: z.enum(["ok", "failed"]),
  createdAt: z.string(),
});
export type VaultUse = z.infer<typeof VaultUseSchema>;
