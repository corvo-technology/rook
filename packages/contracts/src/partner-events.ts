import { z } from "zod";

/**
 * What a partner's own system can tell its customers' agents. A closed catalogue keeps routines
 * and their wording meaningful; `custom` carries a name the partner chooses.
 */
export const PARTNER_EVENT_TYPES = [
  "appointment.created",
  "appointment.cancelled",
  "appointment.no_show",
  "payment.overdue",
  "consultation.finished",
  "customer.created",
  "customer.inactive",
  "custom",
] as const;
export const PartnerEventType = z.enum(PARTNER_EVENT_TYPES);
export type PartnerEventType = z.infer<typeof PartnerEventType>;

export const PARTNER_EVENT_MAX_BODY_BYTES = 16 * 1024;
/** The most events one customer may send in a minute. */
export const PARTNER_EVENT_TENANT_PER_MINUTE = 60;
export const PARTNER_EVENT_RETENTION_DAYS = 30;

const CustomName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_.-]*$/i);

/** What a partner's system sends: what happened, and the facts about it as plain data. */
export const PartnerEventInput = z
  .object({
    type: PartnerEventType,
    /** Required for `custom`, refused for every other type. */
    name: CustomName.optional(),
    /** When it happened in the partner's system; defaults to when it was received. */
    occurredAt: z.iso.datetime({ offset: true }).optional(),
    data: z.record(z.string().max(64), z.unknown()).default({}),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.type === "custom") !== (value.name !== undefined)) {
      ctx.addIssue({
        code: "custom",
        message: "Give a name for custom events, and only for them",
        path: ["name"],
      });
    }
  });
export type PartnerEventInput = z.infer<typeof PartnerEventInput>;

/** One condition on the event's data: a value at a dotted path equals what is written here. */
export const PartnerEventFilter = z
  .object({
    path: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/),
    equals: z.union([z.string().max(200), z.number(), z.boolean()]),
  })
  .strict();
export type PartnerEventFilter = z.infer<typeof PartnerEventFilter>;

/** What starts a routine: one kind of event, narrowed by conditions that must all hold. */
export const RoutineEventTriggerSchema = z
  .object({
    type: PartnerEventType,
    name: CustomName.optional(),
    filters: z.array(PartnerEventFilter).max(5).optional(),
  })
  .strict();
export type RoutineEventTrigger = z.infer<typeof RoutineEventTriggerSchema>;

/** A routine a partner's template gives every customer, started by an event. */
export const PartnerEventRoutine = z
  .object({
    key: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_.:-]+$/),
    /** The key of the template agent that runs it. */
    agent: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(80),
    prompt: z.string().trim().min(1).max(4000),
    on: RoutineEventTriggerSchema,
    /** Whether it starts on. The customer can switch it either way. */
    active: z.boolean().default(true),
  })
  .strict();
export type PartnerEventRoutine = z.infer<typeof PartnerEventRoutine>;

export const PARTNER_EVENT_STATUSES = ["accepted", "rejected"] as const;

/** One received event as the partner's console lists it. */
export const PartnerConsoleEventSchema = z.object({
  id: z.string(),
  externalTenantId: z.string(),
  type: z.string(),
  status: z.enum(PARTNER_EVENT_STATUSES),
  /** Why it was refused; null when accepted. */
  error: z.string().nullable(),
  matched: z.number().int(),
  /** The payload as received, cut short; kept only for rejected events. */
  payload: z.string().nullable(),
  createdAt: z.string(),
});
export type PartnerConsoleEvent = z.infer<typeof PartnerConsoleEventSchema>;

export const PartnerConsoleEventsSchema = z.object({
  /** Events in the last 24 hours. */
  accepted: z.number().int(),
  rejected: z.number().int(),
  byType: z.array(z.object({ type: z.string(), count: z.number().int() })),
  recent: z.array(PartnerConsoleEventSchema),
});
export type PartnerConsoleEvents = z.infer<typeof PartnerConsoleEventsSchema>;

/** A routine that an event starts, as its customer sees it. */
export const EventRoutineSchema = z.object({
  id: z.string(),
  botId: z.string(),
  name: z.string(),
  active: z.boolean(),
  on: RoutineEventTriggerSchema,
  lastTriggeredAt: z.string().nullable(),
});
export type EventRoutine = z.infer<typeof EventRoutineSchema>;
