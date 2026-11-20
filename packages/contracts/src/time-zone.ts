import * as z from "zod";

/** True for an IANA timezone this runtime can format in, such as "Pacific/Auckland". */
export function isValidTimeZone(value: string): boolean {
  // Intl also accepts fixed offsets, which are not IANA timezone names.
  if (/^[+-]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const TimeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, { message: "Unknown timezone" });
