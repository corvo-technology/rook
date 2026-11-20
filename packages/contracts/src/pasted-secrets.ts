/**
 * Spots API keys and tokens in text a person is about to send, so the composer can offer to keep
 * them in the Vault instead of the chat history. Every rule needs a known prefix plus a minimum
 * length, and most need a digit, so ordinary prose and publishable keys are left alone. It runs on
 * the client; the value must never be logged or sent anywhere but the Vault.
 */

export type PastedSecretKindId =
  | "github"
  | "slack"
  | "stripe"
  | "stripe-webhook"
  | "aws"
  | "anthropic"
  | "openrouter"
  | "openai"
  | "google"
  | "jwt"
  | "bearer";

export type PastedSecretKind = {
  id: PastedSecretKindId;
  /** A Vault credential name that is valid as a bot credential and as a shell variable. */
  name: string;
  pattern: RegExp;
  /** Which capture group holds the key; 0 is the whole match. */
  group?: number;
  /** Rules that would flag ordinary prose also need a digit in the key. */
  requireDigit?: boolean;
  requireLetter?: boolean;
};

// A key never starts in the middle of a longer word or token.
const START = "(?<![A-Za-z0-9_-])";

// Order matters: a specific shape wins over the broader one it overlaps.
export const PASTED_SECRET_KINDS: readonly PastedSecretKind[] = [
  {
    id: "anthropic",
    name: "anthropic-key",
    pattern: new RegExp(`${START}sk-ant-[A-Za-z0-9_-]{20,}`, "g"),
    requireDigit: true,
  },
  {
    id: "openrouter",
    name: "openrouter-key",
    pattern: new RegExp(`${START}sk-or-[A-Za-z0-9_-]{32,}`, "g"),
    requireDigit: true,
  },
  {
    id: "openai",
    name: "openai-key",
    pattern: new RegExp(`${START}sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}`, "g"),
    requireDigit: true,
  },
  {
    id: "github",
    name: "github-token",
    pattern: new RegExp(`${START}(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})`, "g"),
  },
  {
    id: "slack",
    name: "slack-token",
    pattern: new RegExp(`${START}(?:xox[abprs]-[A-Za-z0-9-]{10,}|xapp-\\d-[A-Za-z0-9-]{10,})`, "g"),
    requireDigit: true,
  },
  {
    // pk_ keys are publishable and public, so they are not matched.
    id: "stripe",
    name: "stripe-key",
    pattern: new RegExp(`${START}(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}`, "g"),
    requireDigit: true,
  },
  {
    id: "stripe-webhook",
    name: "stripe-webhook-secret",
    pattern: new RegExp(`${START}whsec_[A-Za-z0-9]{24,}`, "g"),
    requireDigit: true,
  },
  {
    id: "aws",
    name: "aws-access-key",
    pattern: new RegExp(`${START}(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])`, "g"),
  },
  {
    id: "google",
    name: "google-ai-key",
    pattern: new RegExp(`${START}AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])`, "g"),
  },
  {
    id: "jwt",
    name: "jwt-token",
    pattern: new RegExp(
      `${START}eyJ[A-Za-z0-9_-]{8,}\\.eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}`,
      "g",
    ),
  },
  {
    // Only the token after the word is the secret.
    id: "bearer",
    name: "bearer-token",
    pattern: /\bBearer[ \t]+([A-Za-z0-9._~+/-]{32,}={0,2})(?![A-Za-z0-9._~+/-])/g,
    group: 1,
    requireDigit: true,
    requireLetter: true,
  },
];

export type PastedSecretMatch = {
  kind: PastedSecretKindId;
  /** The suggested Vault credential name. */
  name: string;
  /** Half-open range of the key inside the searched text. */
  start: number;
  end: number;
};

/** The keys in `text`, in order and without overlaps. */
export function findPastedSecrets(text: string): PastedSecretMatch[] {
  if (text.length < 20) return [];
  const found: PastedSecretMatch[] = [];
  for (const kind of PASTED_SECRET_KINDS) {
    for (const match of text.matchAll(kind.pattern)) {
      const key = match[kind.group ?? 0];
      if (!key) continue;
      if (kind.requireDigit && !/\d/.test(key)) continue;
      if (kind.requireLetter && !/[A-Za-z]/.test(key)) continue;
      const start = match.index + (kind.group ? match[0].indexOf(key) : 0);
      const end = start + key.length;
      if (found.some((other) => start < other.end && other.start < end)) continue;
      found.push({ kind: kind.id, name: kind.name, start, end });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

export function hasPastedSecret(text: string): boolean {
  return findPastedSecrets(text).length > 0;
}
