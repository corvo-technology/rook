/**
 * The From header for one message. A sender configured as "Name of Brand <address>" reads
 * "Name do Brand" in Portuguese; the address and every other value stay as configured.
 */
export function senderFor(from: string, locale?: string): string {
  if (!/^pt([-_]|$)/i.test(locale?.trim() ?? "")) return from;
  return from.replace(/^(\s*"?[^<"]*?\S)\s+of\s+(\S[^<"]*?"?\s*(?:<[^>]*>)?\s*)$/i, "$1 do $2");
}
