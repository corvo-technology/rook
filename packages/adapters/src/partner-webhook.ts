import type { JobPublisher } from "@corvo/adapter-kit";
import type { PartnerWebhookPayload } from "@corvo/contracts";
import { PARTNER_WEBHOOK_EVENTS } from "@corvo/contracts";
import { partnerWebhookSecret, signPartnerWebhook } from "@corvo/core/node/partner-key";
import type { PrismaClient } from "@corvo/db";
import {
  claimPartnerAllowanceNotices,
  runAsSystem,
  undeliveredPartnerWebhookEvents,
} from "@corvo/db";
import { getLogger } from "@corvo/logging";
import type { ResolveHostname } from "./remote-mcp.js";
import { createSafeRemoteFetch } from "./remote-mcp.js";

const DELIVERY_TIMEOUT_MS = 10_000;
/** Retries use the job queue's own backoff; a notice that still fails is left for the sweep. */
const MAX_ATTEMPTS = 8;

export interface PartnerWebhookDeps {
  prisma: PrismaClient;
  /** The deployment's key, from which each partner's signing secret is derived. */
  encryptionKey: string;
  fetch?: typeof globalThis.fetch;
  resolveHostname?: ResolveHostname;
  allowPrivateEndpoint?: boolean;
  now?: () => Date;
}

/**
 * Sends one notice to the partner's webhook: a JSON body with the customer's id and its credit in
 * cents, signed with `X-Rook-Signature` (HMAC-SHA256 of `<timestamp>.<body>`). Nothing secret is
 * in it: no key, no token, no customer data beyond the partner's own id for the customer. Throws
 * on any failure so the job queue retries; a notice already delivered is left alone.
 */
export async function deliverPartnerWebhook(
  deps: PartnerWebhookDeps,
  eventId: string,
): Promise<void> {
  const event = await runAsSystem("deliver a partner webhook", () =>
    deps.prisma.partnerWebhookEvent.findUnique({
      where: { id: eventId },
      include: {
        partner: {
          select: { id: true, enabled: true, webhookUrl: true, webhookSecretVersion: true },
        },
      },
    }),
  );
  if (!event || event.deliveredAt) return;
  const { partner } = event;
  // A partner that switched its webhook off, or was disabled, is owed nothing.
  if (!partner.enabled || !partner.webhookUrl) return;
  if (!(PARTNER_WEBHOOK_EVENTS as readonly string[]).includes(event.kind)) return;

  const payload: PartnerWebhookPayload = {
    id: event.id,
    type: event.kind as PartnerWebhookPayload["type"],
    createdAt: event.createdAt.toISOString(),
    externalTenantId: event.externalTenantId,
    period: event.period,
    grantedCents: event.grantedCents,
    usedCents: event.usedCents,
    remainingCents: Math.max(0, event.grantedCents - event.usedCents),
  };
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor((deps.now?.() ?? new Date()).getTime() / 1000));
  const secret = partnerWebhookSecret(deps.encryptionKey, partner.id, partner.webhookSecretVersion);
  const safeFetch = createSafeRemoteFetch(deps.fetch, deps.resolveHostname, {
    allowPrivateEndpoint: deps.allowPrivateEndpoint,
  });
  try {
    const response = await safeFetch(partner.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-rook-event": payload.type,
        "x-rook-delivery": event.id,
        "x-rook-timestamp": timestamp,
        "x-rook-signature": signPartnerWebhook(secret, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`The partner's webhook answered ${response.status}`);
  } finally {
    await safeFetch.close().catch(() => undefined);
  }
  await runAsSystem("record a delivered partner webhook", () =>
    deps.prisma.partnerWebhookEvent.update({
      where: { id: event.id },
      data: { deliveredAt: deps.now?.() ?? new Date() },
    }),
  );
}

/** Queues a notice for delivery; the job key keeps one job per notice. */
export function enqueuePartnerWebhook(
  jobs: Pick<JobPublisher, "enqueue">,
  eventId: string,
  options: { keepExisting?: boolean } = {},
): Promise<void> {
  return jobs.enqueue({
    name: "partner.webhook",
    payload: { eventId },
    replaceKey: `partner-webhook:${eventId}`,
    maxAttempts: MAX_ATTEMPTS,
    ...(options.keepExisting ? { keepExisting: true } : {}),
  });
}

/**
 * Periodic: records the notices now owed, queues them, and queues again any that were never
 * delivered (a lost job), without disturbing one still retrying.
 */
export function createPartnerWebhookReconciler(deps: {
  prisma: PrismaClient;
  jobs: Pick<JobPublisher, "enqueue">;
  now?: () => Date;
}) {
  return () =>
    runAsSystem("find partner credit notices", async () => {
      const now = deps.now?.() ?? new Date();
      for (const id of await claimPartnerAllowanceNotices(deps.prisma, now)) {
        await enqueuePartnerWebhook(deps.jobs, id).catch((error) =>
          getLogger().error("partner webhook enqueue", error),
        );
      }
      for (const id of await undeliveredPartnerWebhookEvents(deps.prisma, now)) {
        await enqueuePartnerWebhook(deps.jobs, id, { keepExisting: true }).catch((error) =>
          getLogger().error("partner webhook re-enqueue", error),
        );
      }
    });
}
