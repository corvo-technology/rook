const LEADING_SLEEP = /^\s*\(?\s*sleep\s+(\d+(?:\.\d+)?)([smhd]?)(?=[\s;&|)]|$)/;
const UNIT_SECONDS = { "": 1, s: 1, m: 60, h: 3600, d: 86_400 } as const;
// What may follow a sleep and still check nothing: no redirect, pipe, substitution or background.
const HARMLESS_SEGMENT = /^(?:echo|printf|true|:|date)(?:\s+[^<>|&`$()]*)?$/;

/** Seconds of a `sleep N` (optional s/m/h/d suffix) at the very start of a shell command, else 0. */
export function leadingSleepSeconds(command: string): number {
  const match = command.match(LEADING_SLEEP);
  if (!match) return 0;
  return Number(match[1]) * UNIT_SECONDS[(match[2] ?? "") as keyof typeof UNIT_SECONDS];
}

/**
 * The leading sleep's seconds when nothing after it checks anything (only echo, printf, true, `:`
 * or date), else 0. A sleep followed by a real check, or inside a loop, is not an idle sleep.
 */
export function idleSleepSeconds(command: string): number {
  const seconds = leadingSleepSeconds(command);
  if (seconds === 0) return 0;
  const match = command.match(LEADING_SLEEP);
  const closesGroup = command.slice(0, match?.[0].length).includes("(");
  let rest = command.slice(match?.[0].length ?? 0).trim();
  if (closesGroup && rest.startsWith(")")) rest = rest.slice(1).trim();
  if (rest === "") return seconds;
  const segments = rest.split(/&&|\|\||;/).map((segment) => segment.trim());
  return segments.every((segment) => segment === "" || HARMLESS_SEGMENT.test(segment))
    ? seconds
    : 0;
}
