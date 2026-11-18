import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import {
  addConsultationChunk,
  beginConsultationPurge,
  createConsultation,
  findConsultation,
  finishConsultationPurge,
  listConsultationChunks,
  listExpiredConsultations,
  settleConsultation,
  startConsultationProcessing,
} from "./consultations.js";
import { provisionPartnerTenant } from "./partner-tenants.js";
import { createPartner } from "./partners.js";
import { asSystem, runAsTenant } from "./row-security.js";

// Needs DATABASE_URL as the runtime login (row security applies to it).
const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

const LIMITS = { maxChunks: 5, maxBytes: 100 };

describePostgres("consultations (PostgreSQL, runtime login)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  let prisma: PrismaClient;
  let db: PrismaClient;
  let close: () => Promise<void>;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const partnerIds: string[] = [];

  async function fixture(label: string) {
    const { partner } = await createPartner(db, { slug: `acme-${label}-${suffix}`, name: label });
    partnerIds.push(partner.id);
    const tenant = await provisionPartnerTenant(db, partner, {
      externalTenantId: `shop-${label}`,
      name: label,
    });
    organizationIds.push(tenant.organizationId);
    userIds.push(tenant.ownerUserId);
    const consultation = await createConsultation(db, {
      partnerId: partner.id,
      tenantId: tenant.tenantId,
      externalUserId: "doctor-1",
      template: "prontu_evolution",
      context: { clientId: "client-1", clientName: "Maria Souza", professionalName: "Dr. Lima" },
      consent: { obtained: true, at: "2026-12-01T10:00:00Z", method: "verbal", text: "Ok" },
      retentionDays: 30,
    });
    return { partner, tenant, consultation };
  }
  const chunk = (seq: number, size = 10) => ({
    seq,
    artifactId: `object:art-${seq}`,
    size,
    mimeType: "audio/webm",
  });

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

  it("keeps a repeated chunk once and refuses past the count and size caps", async () => {
    const { consultation } = await fixture("caps");
    await expect(addConsultationChunk(db, consultation.id, chunk(1), LIMITS)).resolves.toBe(
      "stored",
    );
    await expect(addConsultationChunk(db, consultation.id, chunk(0), LIMITS)).resolves.toBe(
      "stored",
    );
    await expect(addConsultationChunk(db, consultation.id, chunk(1), LIMITS)).resolves.toBe(
      "duplicate",
    );
    await expect(addConsultationChunk(db, consultation.id, chunk(5), LIMITS)).resolves.toBe(
      "too_many",
    );
    await expect(addConsultationChunk(db, consultation.id, chunk(2, 90), LIMITS)).resolves.toBe(
      "too_large",
    );
    const stored = await listConsultationChunks(db, consultation.id);
    expect(stored.map((c) => c.seq)).toEqual([0, 1]);
  });

  it("holds the caps when uploads arrive together", async () => {
    const { consultation } = await fixture("race");
    const outcomes = await Promise.all(
      [0, 1, 2, 3, 4].map((seq) =>
        addConsultationChunk(db, consultation.id, chunk(seq, 30), LIMITS),
      ),
    );
    expect(outcomes.filter((o) => o === "stored")).toHaveLength(3);
    expect(outcomes.filter((o) => o === "too_large")).toHaveLength(2);
  });

  it("finds a consultation only for its own partner and customer", async () => {
    const a = await fixture("iso-a");
    const b = await fixture("iso-b");
    const own = {
      partnerId: a.partner.id,
      tenantId: a.tenant.tenantId,
      id: a.consultation.id,
    };
    await expect(findConsultation(db, own)).resolves.not.toBeNull();
    await expect(findConsultation(db, { ...own, partnerId: b.partner.id })).resolves.toBeNull();
    await expect(findConsultation(db, { ...own, tenantId: b.tenant.tenantId })).resolves.toBeNull();
  });

  it("is not readable in a customer's own context", async () => {
    const { consultation, tenant } = await fixture("rls");
    const seen = await runAsTenant({ spaceId: tenant.spaceId, userId: tenant.ownerUserId }, () =>
      prisma.consultation.findMany({ where: { id: consultation.id } }),
    );
    expect(seen).toEqual([]);
  });

  it("processes once and settles from processing only", async () => {
    const { consultation } = await fixture("flow");
    await addConsultationChunk(db, consultation.id, chunk(0), LIMITS);
    await expect(startConsultationProcessing(db, consultation.id)).resolves.toBe(true);
    await expect(startConsultationProcessing(db, consultation.id)).resolves.toBe(false);
    await expect(addConsultationChunk(db, consultation.id, chunk(1), LIMITS)).resolves.toBe(
      "closed",
    );
    await expect(
      settleConsultation(db, consultation.id, {
        state: "drafted",
        draftEntryId: "entry-1",
        resultArtifactId: "object:result",
      }),
    ).resolves.toBe(true);
    await expect(
      settleConsultation(db, consultation.id, { state: "failed", errorCode: "internal" }),
    ).resolves.toBe(false);
    const row = await db.consultation.findUniqueOrThrow({ where: { id: consultation.id } });
    expect(row).toMatchObject({ state: "drafted", draftEntryId: "entry-1" });
  });

  it("deletes in two steps, removes names, and retries a half-finished deletion", async () => {
    const { consultation, partner, tenant } = await fixture("purge");
    await addConsultationChunk(db, consultation.id, chunk(0), LIMITS);
    const first = await beginConsultationPurge(db, consultation.id);
    expect(first).toMatchObject({ artifactIds: ["object:art-0"], firstTime: true });
    const bare = await db.consultation.findUniqueOrThrow({ where: { id: consultation.id } });
    expect(bare.purgedAt).not.toBeNull();
    expect(JSON.stringify(bare.context)).not.toContain("Maria");
    expect(JSON.stringify(bare.context)).not.toContain("Lima");
    expect(JSON.stringify(bare.consent)).not.toContain("Ok");
    await expect(
      findConsultation(db, {
        partnerId: partner.id,
        tenantId: tenant.tenantId,
        id: consultation.id,
      }),
    ).resolves.toBeNull();
    // The objects could not be deleted: the references stay, and the next sweep finds them.
    const pending = await listExpiredConsultations(db, new Date(), 500);
    expect(pending.map((row) => row.id)).toContain(consultation.id);
    const again = await beginConsultationPurge(db, consultation.id);
    expect(again).toMatchObject({ artifactIds: ["object:art-0"], firstTime: false });
    await finishConsultationPurge(db, consultation.id);
    await expect(listConsultationChunks(db, consultation.id)).resolves.toEqual([]);
    const done = await listExpiredConsultations(db, new Date(), 500);
    expect(done.map((row) => row.id)).not.toContain(consultation.id);
  });

  it("lists a consultation once its retention has passed, from when it finished", async () => {
    const { consultation } = await fixture("retention");
    const now = new Date();
    await db.consultation.update({
      where: { id: consultation.id },
      data: {
        retentionDays: 7,
        state: "drafted",
        createdAt: new Date(now.getTime() - 40 * 86_400_000),
        finishedAt: new Date(now.getTime() - 6 * 86_400_000),
      },
    });
    const ids = async () => (await listExpiredConsultations(db, now, 500)).map((row) => row.id);
    await expect(ids()).resolves.not.toContain(consultation.id);
    const later = new Date(now.getTime() + 2 * 86_400_000);
    const expired = await listExpiredConsultations(db, later, 500);
    expect(expired.map((row) => row.id)).toContain(consultation.id);
  });

  it("reprocesses a failed consultation, and lists a recording abandoned for two hours", async () => {
    const { consultation } = await fixture("redo");
    await addConsultationChunk(db, consultation.id, chunk(0), LIMITS);
    await startConsultationProcessing(db, consultation.id);
    await settleConsultation(db, consultation.id, { state: "failed", errorCode: "model_failed" });
    await expect(startConsultationProcessing(db, consultation.id)).resolves.toBe(true);
    const row = await db.consultation.findUniqueOrThrow({ where: { id: consultation.id } });
    expect(row).toMatchObject({ state: "processing", errorCode: null });

    const idle = await fixture("idle");
    const now = new Date();
    const old = new Date(now.getTime() - 3 * 3_600_000);
    await db.consultation.update({ where: { id: idle.consultation.id }, data: { createdAt: old } });
    await addConsultationChunk(db, idle.consultation.id, chunk(0), LIMITS);
    const ids = async () => (await listExpiredConsultations(db, now, 500)).map((r) => r.id);
    // A chunk arrived just now, so it is still being recorded.
    await expect(ids()).resolves.not.toContain(idle.consultation.id);
    await db.consultationChunk.updateMany({
      where: { consultationId: idle.consultation.id },
      data: { createdAt: old },
    });
    await expect(ids()).resolves.toContain(idle.consultation.id);
  });
});
