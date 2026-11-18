import type { TransactionalEmail, TransactionalEmailProvider } from "@corvo/adapter-kit";
import { partnerLeadConfirmationEmail, partnerLeadNotificationEmail } from "@corvo/auth";
import type { PrismaClient } from "@corvo/db";
import { runAsSystem } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { readBoundedBody } from "./http-body.js";
import { formCors, windowCounter } from "./public-form.js";
import type { WaitlistLocale } from "./waitlist.js";
import { waitlistLocale } from "./waitlist.js";

/**
 * Partner leads, filled from the marketing site's partners page. Same contract as the waitlist: the
 * endpoint is open, so it answers every well-formed request alike, budgets requests per address and
 * per email, and drops honeypot posts without storing them.
 */
export const PARTNER_LEADS_PATH = "/api/public/partner-leads";
export const MAX_PARTNER_LEAD_REQUEST_BYTES = 16 * 1024;

const IP_WINDOW_MS = 10 * 60_000;
const IP_LIMIT = 8;
const EMAIL_WINDOW_MS = 60 * 60_000;
const EMAIL_LIMIT = 3;

export const PARTNER_TYPES = ["embedded", "white_label", "unsure"] as const;
export const CUSTOMER_RANGES = ["0-50", "50-200", "200-1000", "1000+"] as const;

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

const body = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  company: z.string().trim().min(1).max(120),
  website: optional(300),
  partnerType: z.enum(PARTNER_TYPES),
  country: optional(80),
  customers: z.enum(CUSTOMER_RANGES).optional(),
  message: optional(2000),
  consent: z.literal(true),
  locale: z.string().trim().max(35).optional(),
  source: z.string().trim().max(40).optional(),
  // Hidden from people, filled by bots.
  hp: z.string().max(1000).optional(),
});

export interface PartnerLeadInput {
  name: string;
  email: string;
  company: string;
  website?: string;
  partnerType: (typeof PARTNER_TYPES)[number];
  country?: string;
  customers?: (typeof CUSTOMER_RANGES)[number];
  message?: string;
  locale: WaitlistLocale;
  source?: string;
}

export interface PartnerLeadStore {
  add(lead: PartnerLeadInput): Promise<{ id: string }>;
  markNotified(id: string): Promise<void>;
}

export function prismaPartnerLeadStore(prisma: PrismaClient): PartnerLeadStore {
  return {
    add: (lead) =>
      runAsSystem("partner-leads", () =>
        prisma.partnerLead.create({
          data: {
            name: lead.name,
            email: lead.email,
            company: lead.company,
            website: lead.website ?? null,
            partnerType: lead.partnerType,
            country: lead.country ?? null,
            customers: lead.customers ?? null,
            message: lead.message ?? null,
            locale: lead.locale,
            source: lead.source ?? null,
          },
          select: { id: true },
        }),
      ),
    markNotified: (id) =>
      runAsSystem("partner-leads", async () => {
        await prisma.partnerLead.update({ where: { id }, data: { notifiedAt: new Date() } });
      }),
  };
}

export interface PartnerLeadOptions {
  store: PartnerLeadStore;
  email?: TransactionalEmailProvider;
  /** Origin that serves the logo in the emails. */
  webOrigin: string;
  /** Origins of the marketing site. Empty turns the endpoint off. */
  allowedOrigins: readonly string[];
  notifyEmail?: string;
  clientIp: (c: Context) => string | undefined;
  now?: () => number;
}

export function partnerLeadRoutes(options: PartnerLeadOptions) {
  const { store, email, webOrigin, allowedOrigins, notifyEmail, clientIp } = options;
  const now = options.now ?? Date.now;
  const byIp = windowCounter(IP_WINDOW_MS, now);
  const byEmail = windowCounter(EMAIL_WINDOW_MS, now);
  const pending = new Set<Promise<void>>();
  const app = new Hono();
  const { allowOrigin, reply, preflight } = formCors(allowedOrigins);

  const track = (job: Promise<void>) => {
    pending.add(job);
    void job.finally(() => pending.delete(job));
  };

  async function send(message: TransactionalEmail): Promise<boolean> {
    if (!email) return false;
    try {
      await email.send(message);
      return true;
    } catch (error) {
      getLogger().warn("partner_lead.email_failed", {
        "error.type": error instanceof Error ? error.name : "unknown",
      });
      return false;
    }
  }

  async function deliver(id: string, lead: PartnerLeadInput): Promise<void> {
    if (!email) {
      getLogger().warn("partner_lead.email_unconfigured");
      return;
    }
    if (await send(await partnerLeadConfirmationEmail(webOrigin, lead.email, lead.locale))) {
      await store.markNotified(id).catch(() => {
        getLogger().warn("partner_lead.mark_notified_failed");
      });
    }
    if (notifyEmail) {
      await send(await partnerLeadNotificationEmail(webOrigin, notifyEmail, lead));
    }
  }

  app.options(PARTNER_LEADS_PATH, preflight);

  app.post(PARTNER_LEADS_PATH, async (c) => {
    if (allowedOrigins.length === 0 || !allowOrigin(c)) return reply(c, 403, { ok: false });
    const type = c.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (type !== "application/json") return reply(c, 415, { ok: false });
    if (byIp(`ip:${clientIp(c) ?? "unknown"}`) > IP_LIMIT) {
      c.header("retry-after", String(IP_WINDOW_MS / 1000));
      return reply(c, 429, { ok: false });
    }
    const text = await readBoundedBody(c.req.raw, MAX_PARTNER_LEAD_REQUEST_BYTES);
    if (text === null) return reply(c, 413, { ok: false });
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return reply(c, 400, { ok: false });
    }
    const parsed = body.safeParse(json);
    if (!parsed.success) return reply(c, 400, { ok: false });
    const { hp, locale, consent: _consent, ...fields } = parsed.data;
    if (hp) return reply(c, 200, { ok: true });
    if (byEmail(`email:${fields.email}`) > EMAIL_LIMIT) {
      c.header("retry-after", String(EMAIL_WINDOW_MS / 1000));
      return reply(c, 429, { ok: false });
    }
    const lead: PartnerLeadInput = {
      name: fields.name,
      email: fields.email,
      company: fields.company,
      partnerType: fields.partnerType,
      ...(fields.website ? { website: fields.website } : {}),
      ...(fields.country ? { country: fields.country } : {}),
      ...(fields.customers ? { customers: fields.customers } : {}),
      ...(fields.message ? { message: fields.message } : {}),
      ...(fields.source ? { source: fields.source } : {}),
      locale: waitlistLocale(locale),
    };
    try {
      const stored = await store.add(lead);
      // The reply does not wait for the email.
      track(deliver(stored.id, lead));
    } catch (error) {
      getLogger().error("partner_lead.store_failed", error);
      return reply(c, 200, { ok: true });
    }
    return reply(c, 200, { ok: true });
  });

  return Object.assign(app, { idle: () => Promise.all([...pending]).then(() => undefined) });
}
