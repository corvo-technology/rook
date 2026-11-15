const ADDRESS = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']+$/;

/**
 * Reads pasted addresses: one per line or separated by commas or semicolons, each bare or as
 * `Name <address>`. Returns distinct lowercase addresses and what could not be read.
 */
export function parseInviteAddresses(raw: string): { addresses: string[]; rejected: string[] } {
  const addresses = new Set<string>();
  const rejected: string[] = [];
  for (const part of raw.split(/[\n,;]+/)) {
    const item = part.trim();
    if (!item) continue;
    const angled = /<([^<>]+)>\s*$/.exec(item);
    const candidates = angled ? [angled[1]!.trim()] : item.split(/\s+/);
    const found = candidates.filter((candidate) => ADDRESS.test(candidate));
    if (found.length === 0) {
      rejected.push(item);
      continue;
    }
    for (const address of found) addresses.add(address.toLowerCase());
  }
  return { addresses: [...addresses], rejected };
}

/** Splits parsed addresses into those to invite and those who already belong to the space. */
export function splitInvitees(
  addresses: readonly string[],
  memberEmails: readonly string[],
): { toInvite: string[]; alreadyIn: string[] } {
  const members = new Set(memberEmails.map((email) => email.trim().toLowerCase()));
  return {
    toInvite: addresses.filter((address) => !members.has(address)),
    alreadyIn: addresses.filter((address) => members.has(address)),
  };
}

/** What to call someone in a list: their name, or the start of their address when it is only a placeholder. */
export function personName(name: string | null | undefined, email: string): string {
  const trimmed = name?.trim() ?? "";
  if (trimmed && trimmed !== "Account") return trimmed;
  return email.split("@")[0] || email;
}
