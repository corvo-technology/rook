import type { PrismaClient } from "./client.js";

export type BillingNoticeKind = "confirmation" | "renewal_reminder";

type Db = Pick<PrismaClient, "billingNotice">;

/**
 * Records that a notice is about to be sent: true for the first caller with this key, false when
 * it was already sent or is being sent. Run as the system, like every billing job.
 */
export async function claimBillingNotice(
  prisma: Db,
  notice: {
    kind: BillingNoticeKind;
    organizationId: string;
    subscriptionId: string;
    key: string;
  },
): Promise<boolean> {
  const created = await prisma.billingNotice.createMany({ data: notice, skipDuplicates: true });
  return created.count === 1;
}

/** Gives a claim back when the send failed, so the next run tries again. */
export async function releaseBillingNotice(prisma: Db, key: string): Promise<void> {
  await prisma.billingNotice.deleteMany({ where: { key } });
}

/**
 * The people a subscription's emails go to: the organization's owners, with their language. The
 * language the account saved wins; an owner who never saved one gets the language of their
 * registered device, and then none (English).
 */
export async function billingNoticeRecipients(
  prisma: Pick<PrismaClient, "member">,
  organizationId: string,
): Promise<Array<{ email: string; locale: string | null }>> {
  const owners = await prisma.member.findMany({
    where: { organizationId, role: { contains: "owner" } },
    select: {
      user: { select: { email: true, locale: true, pushToken: { select: { locale: true } } } },
    },
  });
  return owners.map(({ user }) => ({
    email: user.email,
    locale: user.locale ?? user.pushToken?.locale ?? null,
  }));
}
