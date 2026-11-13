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
