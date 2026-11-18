import type { TransactionalEmail, TransactionalEmailProvider } from "@corvo/adapter-kit";
import { waitlistConfirmationEmail, waitlistNotificationEmail } from "@corvo/auth";
import type { PrismaClient } from "@corvo/db";
import { runAsSystem } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { readBoundedBody } from "./http-body.js";
import { formCors, windowCounter } from "./public-form.js";

/**
 * Closed-beta waitlist, filled from the marketing site. The endpoint is open, so it answers every
 * well-formed request the same way (never whether an address is already on the list), budgets
 * requests per address and per email, and drops honeypot posts without storing them.
 */
export const WAITLIST_PATH = "/api/public/waitlist";
export const MAX_WAITLIST_REQUEST_BYTES = 8 * 1024;

const IP_WINDOW_MS = 10 * 60_000;
const IP_LIMIT = 8;
const EMAIL_WINDOW_MS = 60 * 60_000;
const EMAIL_LIMIT = 3;

export type WaitlistLocale = "pt-BR" | "en";

const body = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  company: z.string().trim().min(1).max(120),
  task: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((task) => task || undefined),
  locale: z.string().trim().max(35).optional(),
  source: z.string().trim().max(40).optional(),
  // Hidden from people, filled by bots.
  website: z.string().max(1000).optional(),
});

export interface WaitlistEntryInput {
  email: string;
  company: string;
  task?: string;
  locale: WaitlistLocale;
  source?: string;
}

export interface WaitlistStore {
  /** Stores the entry; `null` when the email is already on the list. */
  add(entry: WaitlistEntryInput): Promise<{ id: string } | null>;
  markNotified(id: string): Promise<void>;
}

export function prismaWaitlistStore(prisma: PrismaClient): WaitlistStore {
  return {
    add: (entry) =>
      runAsSystem("waitlist", async () => {
        try {
          const row = await prisma.waitlistEntry.create({
            data: {
              email: entry.email,
              company: entry.company,
              task: entry.task ?? null,
              locale: entry.locale,
              source: entry.source ?? null,
            },
            select: { id: true },
          });
          return row;
        } catch (error) {
          if ((error as { code?: string }).code === "P2002") return null;
          throw error;
        }
      }),
    markNotified: (id) =>
      runAsSystem("waitlist", async () => {
        await prisma.waitlistEntry.update({ where: { id }, data: { notifiedAt: new Date() } });
      }),
  };
}

/** `pt`, `pt-br` and `pt_BR` are Brazilian Portuguese; everything else gets English. */
export function waitlistLocale(value: string | undefined): WaitlistLocale {
  return /^pt([-_]|$)/i.test(value?.trim() ?? "") ? "pt-BR" : "en";
}

export interface WaitlistOptions {
  store: WaitlistStore;
  email?: TransactionalEmailProvider;
  /** Origin that serves the logo in the emails. */
  webOrigin: string;
  /** Origins of the marketing site. Empty turns the endpoint off. */
  allowedOrigins: readonly string[];
  notifyEmail?: string;
  clientIp: (c: Context) => string | undefined;
  now?: () => number;
}

export function waitlistRoutes(options: WaitlistOptions) {
  const { store, email, webOrigin, allowedOrigins, notifyEmail, clientIp } = options;
  const now = options.now ?? Date.now;
  const byIp = windowCounter(IP_WINDOW_MS, now);
  const byEmail = windowCounter(EMAIL_WINDOW_MS, now);
  const pending = new Set<Promise<void>>();
  const app = new Hono();

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
      getLogger().warn("waitlist.email_failed", {
        "error.type": error instanceof Error ? error.name : "unknown",
      });
      return false;
    }
  }

  async function deliver(id: string, entry: WaitlistEntryInput): Promise<void> {
    if (!email) {
      getLogger().warn("waitlist.email_unconfigured");
      return;
    }
    if (await send(await waitlistConfirmationEmail(webOrigin, entry.email, entry.locale))) {
      await store.markNotified(id).catch(() => {
        getLogger().warn("waitlist.mark_notified_failed");
      });
    }
    if (notifyEmail) {
      await send(await waitlistNotificationEmail(webOrigin, notifyEmail, entry));
    }
  }

  const { allowOrigin, reply, preflight } = formCors(allowedOrigins);

  app.options(WAITLIST_PATH, preflight);

  app.post(WAITLIST_PATH, async (c) => {
    // A browser always sends Origin on a cross-site POST; a request without an allowed one is not the form.
    if (allowedOrigins.length === 0 || !allowOrigin(c)) {
      return reply(c, 403, { ok: false });
    }
    const type = c.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (type !== "application/json") return reply(c, 415, { ok: false });
    if (byIp(`ip:${clientIp(c) ?? "unknown"}`) > IP_LIMIT) {
      c.header("retry-after", String(IP_WINDOW_MS / 1000));
      return reply(c, 429, { ok: false });
    }
    const text = await readBoundedBody(c.req.raw, MAX_WAITLIST_REQUEST_BYTES);
    if (text === null) return reply(c, 413, { ok: false });
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return reply(c, 400, { ok: false });
    }
    const parsed = body.safeParse(json);
    if (!parsed.success) return reply(c, 400, { ok: false });
    const { website, locale, ...fields } = parsed.data;
    if (website) return reply(c, 200, { ok: true });
    if (byEmail(`email:${fields.email}`) > EMAIL_LIMIT) {
      c.header("retry-after", String(EMAIL_WINDOW_MS / 1000));
      return reply(c, 429, { ok: false });
    }
    const entry: WaitlistEntryInput = {
      email: fields.email,
      company: fields.company,
      ...(fields.task ? { task: fields.task } : {}),
      ...(fields.source ? { source: fields.source } : {}),
      locale: waitlistLocale(locale),
    };
    try {
      const stored = await store.add(entry);
      // The reply is the same whether or not the address was already listed, and does not
      // wait for the email, so timing says nothing either.
      if (stored) track(deliver(stored.id, entry));
    } catch (error) {
      getLogger().error("waitlist.store_failed", error);
      return reply(c, 200, { ok: true });
    }
    return reply(c, 200, { ok: true });
  });

  return Object.assign(app, { idle: () => Promise.all([...pending]).then(() => undefined) });
}
