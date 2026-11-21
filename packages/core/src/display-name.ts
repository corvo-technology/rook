import type { MessageBlock } from "@corvo/contracts";
import { identitySource, preserveIdentitySource } from "./identity-source.js";

/** Deliberately narrow: complete tokens only, never substrings of prose or short handles. */
export function isOpaqueName(name: string): boolean {
  return (
    /^__[A-Za-z0-9_-]+__$/.test(name) ||
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(name) ||
    // Cuid v1 has a fixed prefix/length; cuid2 is 24 lowercase alphanumerics.
    (/^c[a-z0-9]{24}$/.test(name) && /[0-9]/.test(name)) ||
    (/^[a-z][a-z0-9]{23}$/.test(name) && /[0-9]/.test(name)) ||
    // Require interspersed digits and unstructured casing; numbered words/handles stay names.
    (/^[A-Za-z0-9_-]{20,}$/.test(name) &&
      /[a-z]/.test(name) &&
      /[A-Z]/.test(name) &&
      /[0-9]/.test(name) &&
      !/^[A-Za-z_-]+[0-9]+$/.test(name) &&
      !/^[A-Za-z][a-z]*(?:[A-Z][a-z]+|[0-9]|[_-][A-Za-z][a-z]+)*$/.test(name))
  );
}

export function displayName(name: string | null | undefined, fallback: string): string {
  const trimmed = name?.trim() ?? "";
  return trimmed && /[\p{L}\p{N}]/u.test(trimmed) && !isOpaqueName(trimmed) ? trimmed : fallback;
}

/** Names an account gets when nobody chose one; showing or greeting someone by them is wrong. */
export const PLACEHOLDER_ACCOUNT_NAMES: ReadonlySet<string> = new Set([
  "account",
  "user",
  "usuario",
  "usuário",
  "conta",
  "admin",
]);

export function accountDisplay(
  account: { name?: string | null; email?: string | null; image?: string | null },
  fallback: string,
): { label: string; initial: string | null; image: string | null } {
  const email = account.email?.trim() ?? "";
  const named = displayName(account.name, "");
  // A placeholder is not a name: the email says more about who this is.
  const name = PLACEHOLDER_ACCOUNT_NAMES.has(named.toLowerCase()) ? "" : named;
  const comparable = name.toLowerCase();
  const emailDerived =
    email &&
    (comparable === email.toLowerCase() || comparable === email.split("@")[0]?.toLowerCase());
  const label = (emailDerived ? "" : name) || email || fallback;
  return {
    label,
    initial: label.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? null,
    image: account.image || null,
  };
}

/** Only identity metadata changes; message text, filenames and tool identifiers stay literal. */
export function displayMessageBlock(
  block: MessageBlock,
  labels = { bot: "Bot", member: "Member", subagent: "subagent" },
): MessageBlock {
  const source = block;
  block = identitySource(block);
  const named = (next: MessageBlock) => preserveIdentitySource(source, next);
  switch (block.kind) {
    case "bot_message_sent":
      return named({ ...block, toBotName: displayName(block.toBotName, labels.bot) });
    case "bot_message_received":
      return named({ ...block, fromBotName: displayName(block.fromBotName, labels.bot) });
    case "subagent":
      return named({ ...block, name: displayName(block.name, labels.subagent) });
    case "child_bot":
      return named({ ...block, name: displayName(block.name, labels.bot) });
    case "channel_message":
      return named({ ...block, fromLabel: displayName(block.fromLabel, labels.member) });
    default:
      return block;
  }
}

/** Up to two letters: the first of the first and last word, or the first two of a single name. */
export function personInitials(name: string): string {
  // An address stands in for a name only until there is one: its own part before the @ is what reads.
  const words =
    (name.includes("@") ? (name.split("@")[0] ?? "") : name).match(/[\p{L}\p{N}]+/gu) ?? [];
  const first = words[0];
  if (!first) return "?";
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  const letters = last
    ? `${[...first][0] ?? ""}${[...last][0] ?? ""}`
    : [...first].slice(0, 2).join("");
  return letters.toUpperCase();
}
