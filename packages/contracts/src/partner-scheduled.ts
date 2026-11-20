import { z } from "zod";
import { TimeZoneSchema } from "./time-zone.js";

/** The most schedules one routine may have. */
export const PARTNER_SCHEDULED_MAX_CRONS = 3;

/**
 * Five fields with the minute fixed (`0 18 * * 1-5`), so no schedule fires more than once an hour.
 * `@once` and other shortcuts are not schedules a template can give.
 */
const CRON = /^\d{1,2}(?: \S+){4}$/;

/** A routine a partner's template gives every customer, started by the clock. */
export const PartnerScheduledRoutine = z
  .object({
    key: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_.:-]+$/),
    /** The key of the template agent that runs it. */
    agent: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(80),
    /** Data for the agent, not an instruction to the platform. */
    prompt: z.string().trim().min(1).max(4000),
    /** Cron expressions in the customer's timezone, such as `0 18 * * *`; at most once an hour each. */
    crons: z
      .array(z.string().regex(CRON, "Use five fields with a fixed minute, such as 0 18 * * *"))
      .min(1)
      .max(PARTNER_SCHEDULED_MAX_CRONS),
    /** Overrides the customer's and the template's timezone for this routine. */
    timezone: TimeZoneSchema.optional(),
    /** Whether it starts on. The customer can switch it either way. */
    active: z.boolean().default(true),
  })
  .strict();
export type PartnerScheduledRoutine = z.infer<typeof PartnerScheduledRoutine>;
