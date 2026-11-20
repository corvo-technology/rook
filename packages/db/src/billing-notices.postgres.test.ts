import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  billingNoticeRecipients,
  claimBillingNotice,
  releaseBillingNotice,
} from "./billing-notices.js";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { asSystem } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("billing notices (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const organizationId = `notice-org-${suffix}`;
  const ownerId = `notice-owner-${suffix}`;
  const memberId = `notice-member-${suffix}`;
  let prisma: PrismaClient;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = asSystem(db.prisma);
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    for (const id of [ownerId, memberId])
      await prisma.user.create({
        data: { id, name: id, email: `${id}@corvo.test`, emailVerified: false },
      });
    await prisma.organization.create({
      data: { id: organizationId, name: "Notice Org", slug: organizationId, createdAt: new Date() },
    });
    await prisma.member.createMany({
      data: [
        {
          id: `m-${ownerId}`,
          organizationId,
          userId: ownerId,
          role: "owner",
          createdAt: new Date(),
        },
        {
          id: `m-${memberId}`,
          organizationId,
          userId: memberId,
          role: "member",
          createdAt: new Date(),
        },
      ],
    });
    await prisma.pushToken.create({
      data: {
        userId: ownerId,
        ciphertext: "x",
        tokenDigest: `digest-${suffix}`,
        sessionId: "s",
        locale: "pt-BR",
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.billingNotice.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, memberId] } } });
    await close();
  });

  const notice = (key: string) => ({
    kind: "confirmation" as const,
    organizationId,
    subscriptionId: "sub_1",
    key: `${key}-${suffix}`,
  });

  it("lets one caller claim a key and refuses the rest", async () => {
    expect(await claimBillingNotice(prisma, notice("once"))).toBe(true);
    expect(await claimBillingNotice(prisma, notice("once"))).toBe(false);
    expect(await claimBillingNotice(prisma, notice("other"))).toBe(true);
  });

  it("gives a claim back so a failed send can be tried again", async () => {
    expect(await claimBillingNotice(prisma, notice("retry"))).toBe(true);
    await releaseBillingNotice(prisma, `retry-${suffix}`);
    expect(await claimBillingNotice(prisma, notice("retry"))).toBe(true);
  });

  it("finds the owners with their app language and nobody else", async () => {
    expect(await billingNoticeRecipients(prisma, organizationId)).toEqual([
      { email: `${ownerId}@corvo.test`, locale: "pt-BR" },
    ]);
  });
});
