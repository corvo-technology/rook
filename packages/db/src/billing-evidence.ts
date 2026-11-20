import type { BillingEvidence } from "@corvo/adapter-kit";
import type { PrismaClient } from "./client.js";

/**
 * Journals what a verified billing webhook said about a payment or subscription, and the
 * customer's acceptance of the terms when it carries one. Appends to the immutable journal and
 * is safe to repeat: each provider event, and each accepted checkout session, is stored once.
 * Run as the system: a webhook has no tenant. Keeps ids and amounts only.
 */
export async function recordBillingEvidence(
  prisma: Pick<PrismaClient, "billingAccount" | "billingAuditEvent">,
  customerId: string,
  evidence: BillingEvidence,
): Promise<void> {
  const account = await prisma.billingAccount.findUnique({
    where: { customerId },
    select: { organizationId: true },
  });
  const common = {
    organizationId: account?.organizationId ?? null,
    currency: evidence.currency ?? "usd",
    createdAt: evidence.occurredAt,
  };
  const { eventId, occurredAt, ...facts } = evidence;
  const details = { customerId, eventId, occurredAt: occurredAt.toISOString(), ...facts };
  const rows = [
    { ...common, source: `stripe:${eventId}`, kind: `stripe.${evidence.type}`, details },
    ...(evidence.termsAccepted && evidence.sessionId
      ? [
          {
            ...common,
            source: `terms:${evidence.sessionId}`,
            kind: "terms_accepted",
            details: {
              customerId,
              sessionId: evidence.sessionId,
              termsVersion: evidence.termsVersion ?? null,
              acceptedAt: occurredAt.toISOString(),
            },
          },
        ]
      : []),
  ];
  await prisma.billingAuditEvent.createMany({ data: rows, skipDuplicates: true });
}
