import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import {
  admitPartnerMember,
  listPartnerMembers,
  partnerIdentityHeaders,
} from "./partner-members.js";
import { provisionPartnerTenant, setPartnerTenantState } from "./partner-tenants.js";
import { createPartner } from "./partners.js";
import { asSystem } from "./row-security.js";
import { getSpaceMembershipFor } from "./space-membership.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("partner members (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  let prisma: PrismaClient;
  let db: PrismaClient;
  let close: () => Promise<void>;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const partnerIds: string[] = [];
  let counter = 0;

  async function setup() {
    const label = `m${++counter}`;
    const { partner } = await createPartner(db, { slug: `acme-${label}-${suffix}`, name: label });
    partnerIds.push(partner.id);
    const tenant = await provisionPartnerTenant(db, partner, {
      externalTenantId: `shop-${label}`,
      name: label,
    });
    organizationIds.push(tenant.organizationId);
    userIds.push(tenant.ownerUserId);
    const input = (over: { externalUserId?: string; role?: string; scope?: object | null }) => ({
      tenantId: tenant.tenantId,
      organizationId: tenant.organizationId,
      ownerUserId: tenant.ownerUserId,
      externalUserId: over.externalUserId ?? "u1",
      externalEmail: null,
      role: over.role ?? "reception",
      scope: (over.scope ?? null) as Record<string, unknown> | null,
      permissions: ["talk_to_agents" as const],
    });
    return { partner, tenant, input, label };
  }

  beforeAll(() => {
    const connection = createDb(databaseUrl!);
    prisma = connection.prisma;
    db = asSystem(prisma);
    close = async () => {
      await prisma.$disconnect();
      await connection.pool.end();
    };
  });
  afterAll(async () => {
    await db.partner.deleteMany({ where: { id: { in: partnerIds } } });
    await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await close();
  });

  it("opens the customer's owner for the owner role and a user of their own for any other", async () => {
    const { tenant, input } = await setup();
    const owner = await admitPartnerMember(db, input({ externalUserId: "boss", role: "owner" }));
    expect(owner.userId).toBe(tenant.ownerUserId);
    const staff = await admitPartnerMember(db, input({ externalUserId: "ana" }));
    userIds.push(staff.userId);
    expect(staff.userId).not.toBe(tenant.ownerUserId);
    const again = await admitPartnerMember(db, input({ externalUserId: "ana" }));
    expect(again).toMatchObject({
      userId: staff.userId,
      previousRole: "reception",
      created: false,
    });
    const other = await admitPartnerMember(db, input({ externalUserId: "bia" }));
    userIds.push(other.userId);
    expect(other.userId).not.toBe(staff.userId);
  });

  it("holds exactly the rights of the role, and a changed role holds from the next session", async () => {
    const { tenant, input } = await setup();
    const first = await admitPartnerMember(db, {
      ...input({ externalUserId: "ana", role: "reception" }),
      permissions: ["talk_to_agents"],
    });
    userIds.push(first.userId);
    const space = { spaceId: tenant.spaceId, userId: first.userId };
    const before = await getSpaceMembershipFor(db, space);
    expect(before?.isOwner).toBe(false);
    expect(before?.permissions).toEqual(["talk_to_agents"]);
    await admitPartnerMember(db, {
      ...input({ externalUserId: "ana", role: "manager" }),
      permissions: ["talk_to_agents", "approve_actions"],
    });
    const after = await getSpaceMembershipFor(db, space);
    expect([...(after?.permissions ?? [])].sort()).toEqual(["approve_actions", "talk_to_agents"]);
    expect(after?.roleIds).toHaveLength(1);
  });

  it("records the role and scope, and tells the connector who is asking", async () => {
    const { tenant, input } = await setup();
    const staff = await admitPartnerMember(
      db,
      input({ externalUserId: "ana", role: "professional", scope: { professionalId: "p-1" } }),
    );
    userIds.push(staff.userId);
    await expect(listPartnerMembers(db, tenant.tenantId)).resolves.toMatchObject([
      { externalUserId: "ana", role: "professional", scope: { professionalId: "p-1" } },
    ]);
    const headers = partnerIdentityHeaders(db);
    await expect(headers({ spaceId: tenant.spaceId, userId: staff.userId })).resolves.toEqual({
      "X-Rook-User": "ana",
      "X-Rook-Role": "professional",
      "X-Rook-Scope": JSON.stringify({ professionalId: "p-1" }),
    });
    await expect(headers({ spaceId: tenant.spaceId, userId: "someone-else" })).resolves.toBeNull();
  });

  it("signs a person out when the customer is suspended", async () => {
    const { partner, tenant, input, label } = await setup();
    const staff = await admitPartnerMember(db, input({ externalUserId: "ana" }));
    userIds.push(staff.userId);
    await db.session.create({
      data: {
        id: `s-${label}-${suffix}`,
        token: `t-${label}-${suffix}`,
        userId: staff.userId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await setPartnerTenantState(db, partner.id, `shop-${label}`, "suspended");
    await expect(db.session.count({ where: { userId: staff.userId } })).resolves.toBe(0);
    expect(tenant.tenantId).toBeTruthy();
  });
});
