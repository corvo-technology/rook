import type { PartnerPricingConfig } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import {
  livePartnerPricing,
  PartnerPricingError,
  partnerPricingAt,
  partnerPricingHistory,
  publishPartnerPricing,
} from "./partner-pricing.js";

type Row = { version: number; config: unknown; createdAt: Date; effectiveAt: Date };

function fakePrisma() {
  const rows: Row[] = [];
  const byNewest = (a: Row, b: Row) =>
    b.effectiveAt.getTime() - a.effectiveAt.getTime() || b.version - a.version;
  const prisma = {
    partnerPricingVersion: {
      findFirst: async ({
        where,
        orderBy,
      }: {
        where?: { effectiveAt: { lte: Date } };
        orderBy: unknown;
      }) => {
        const found = rows.filter((row) => !where || row.effectiveAt <= where.effectiveAt.lte);
        const byVersion = !Array.isArray(orderBy);
        return [...found].sort(byVersion ? (a, b) => b.version - a.version : byNewest)[0] ?? null;
      },
      findMany: async () => [...rows].sort(byNewest),
      create: async ({ data }: { data: Omit<Row, "createdAt"> }) => {
        rows.push({ ...data, createdAt: new Date("2026-11-01T00:00:00Z") });
      },
    },
  };
  return { prisma: prisma as unknown as PrismaClient, rows };
}

const config = (topupMarkupBps: number): PartnerPricingConfig => ({
  tiers: [],
  costs: { models: {}, voiceMinuteMicros: 0, computerMinuteMicros: 0, storageGbMonthMicros: 0 },
  margins: { tokensBps: 0, perModelBps: {}, voiceBps: 0, computerMinuteBps: 0, storageBps: 0 },
  storageAllowanceGb: 0,
  topupMarkupBps,
  topupExpiryDays: null,
  lowBalanceBps: 0,
});

const NOW = new Date("2026-11-10T15:00:00Z");

describe("pricing versions with an effective date", () => {
  it("is live at once when no day is given or the day is today", async () => {
    const { prisma, rows } = fakePrisma();
    await publishPartnerPricing(prisma, config(100), null, { now: NOW });
    await publishPartnerPricing(prisma, config(200), null, { effectiveOn: "2026-11-10", now: NOW });
    expect(rows.map((row) => row.effectiveAt)).toEqual([NOW, NOW]);
    expect((await livePartnerPricing(prisma, NOW))?.version).toBe(2);
  });

  it("refuses a day that has passed", async () => {
    const { prisma, rows } = fakePrisma();
    await expect(
      publishPartnerPricing(prisma, config(100), null, { effectiveOn: "2026-11-09", now: NOW }),
    ).rejects.toThrow(PartnerPricingError);
    expect(rows).toHaveLength(0);
  });

  it("keeps the live version until a later one starts", async () => {
    const { prisma } = fakePrisma();
    await publishPartnerPricing(prisma, config(100), null, { now: NOW });
    await publishPartnerPricing(prisma, config(500), null, { effectiveOn: "2026-12-01", now: NOW });
    expect((await livePartnerPricing(prisma, NOW))?.config.topupMarkupBps).toBe(100);
    const dec = new Date("2026-12-01T00:00:00Z");
    expect((await livePartnerPricing(prisma, dec))?.config.topupMarkupBps).toBe(500);
  });

  it("prices a period with the version live when it began", async () => {
    const { prisma } = fakePrisma();
    await publishPartnerPricing(prisma, config(100), null, {
      now: new Date("2026-10-01T00:00:00Z"),
    });
    await publishPartnerPricing(prisma, config(300), null, {
      now: new Date("2026-11-15T00:00:00Z"),
    });
    const periodStart = new Date("2026-11-01T00:00:00Z");
    expect((await partnerPricingAt(prisma, periodStart))?.version).toBe(1);
    expect((await partnerPricingAt(prisma, new Date("2026-11-16T00:00:00Z")))?.version).toBe(2);
    expect(await partnerPricingAt(prisma, new Date("2026-09-01T00:00:00Z"))).toBeNull();
  });

  it("lists the history newest first with what is live and what is scheduled", async () => {
    const { prisma } = fakePrisma();
    await publishPartnerPricing(prisma, config(100), null, {
      now: new Date("2026-10-01T00:00:00Z"),
    });
    await publishPartnerPricing(prisma, config(200), null, {
      now: new Date("2026-11-01T00:00:00Z"),
    });
    await publishPartnerPricing(prisma, config(300), null, { effectiveOn: "2026-12-01", now: NOW });
    const history = await partnerPricingHistory(prisma, NOW);
    expect(history.map((row) => [row.version, row.status])).toEqual([
      [3, "scheduled"],
      [2, "live"],
      [1, "past"],
    ]);
  });
});
