import type { PrismaClient } from "./client.js";
import { parseRateE8 } from "./commerce-money.js";

/** Commerce policy. Every value can be replaced per deployment through `commerce_settings`. */
export interface CommerceSettings {
  /** Days a past-due or unrenewed plan keeps access before it lapses. */
  graceDays: number;
  /** Safety spread taken off the FX rate when granting credit, in basis points. */
  fxSpreadBps: number;
  /** Months a purchased top-up lasts. */
  topupExpiryMonths: number;
  /** Days an invoice to a partner is due after it is issued. */
  invoiceDueDays: number;
  /** The most one top-up call and one day of top-ups may add, in the partner's minor units. */
  maxTopupMinorPerCall: number;
  maxTopupMinorPerDay: number;
  /** The share of plan credit used that raises the low-credit notice, in basis points. */
  lowCreditBps: number;
}

export const COMMERCE_SETTING_DEFAULTS: CommerceSettings = {
  graceDays: 7,
  fxSpreadBps: 300,
  topupExpiryMonths: 12,
  invoiceDueDays: 10,
  maxTopupMinorPerCall: 5_000_000,
  maxTopupMinorPerDay: 20_000_000,
  lowCreditBps: 8000,
};

export async function commerceSettings(prisma: PrismaClient): Promise<CommerceSettings> {
  const rows = await prisma.commerceSetting.findMany();
  const settings: CommerceSettings = { ...COMMERCE_SETTING_DEFAULTS };
  for (const row of rows) {
    if (
      row.key in settings &&
      typeof row.value === "number" &&
      Number.isSafeInteger(row.value) &&
      row.value >= 0
    ) {
      (settings as unknown as Record<string, number>)[row.key] = row.value;
    }
  }
  return settings;
}

export async function setCommerceSetting(
  prisma: PrismaClient,
  key: keyof CommerceSettings,
  value: number,
): Promise<void> {
  if (!(key in COMMERCE_SETTING_DEFAULTS)) throw new Error(`Unknown setting: ${key}`);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("A setting is a whole number");
  await prisma.commerceSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export const COMMERCE_CURRENCIES = ["BRL", "USD"] as const;
export type CommerceCurrency = (typeof COMMERCE_CURRENCIES)[number];

/** `BR` gives `BRL`, anything else `USD`. */
export function currencyForCountry(country: string | null | undefined): CommerceCurrency {
  return country?.toUpperCase() === "BR" ? "BRL" : "USD";
}

export interface CatalogItem {
  key: string;
  name: string;
  baseMinor: number;
  creditMinor: number;
}

export interface CatalogView {
  currency: string;
  plans: CatalogItem[];
  packs: CatalogItem[];
}

/** The active plans and packs that have a price in the currency, in display order. */
export async function readCatalog(prisma: PrismaClient, currency: string): Promise<CatalogView> {
  const [plans, packs] = await Promise.all([
    prisma.catalogPlan.findMany({
      where: { active: true, prices: { some: { currency } } },
      orderBy: [{ position: "asc" }, { key: "asc" }],
      include: { prices: { where: { currency } } },
    }),
    prisma.catalogPack.findMany({
      where: { active: true, prices: { some: { currency } } },
      orderBy: [{ position: "asc" }, { key: "asc" }],
      include: { prices: { where: { currency } } },
    }),
  ]);
  const item = (row: {
    key: string;
    name: string;
    prices: Array<{ amountMinor: number; creditMinor: number }>;
  }) => ({
    key: row.key,
    name: row.name,
    baseMinor: row.prices[0]!.amountMinor,
    creditMinor: row.prices[0]!.creditMinor,
  });
  return { currency, plans: plans.map(item), packs: packs.map(item) };
}

export async function findCatalogPlan(
  prisma: PrismaClient,
  key: string,
  currency: string,
): Promise<CatalogItem | null> {
  const plan = await prisma.catalogPlan.findFirst({
    where: { key, active: true },
    include: { prices: { where: { currency } } },
  });
  const price = plan?.prices[0];
  return plan && price
    ? {
        key: plan.key,
        name: plan.name,
        baseMinor: price.amountMinor,
        creditMinor: price.creditMinor,
      }
    : null;
}

export async function findCatalogPack(
  prisma: PrismaClient,
  key: string,
  currency: string,
): Promise<CatalogItem | null> {
  const pack = await prisma.catalogPack.findFirst({
    where: { key, active: true },
    include: { prices: { where: { currency } } },
  });
  const price = pack?.prices[0];
  return pack && price
    ? {
        key: pack.key,
        name: pack.name,
        baseMinor: price.amountMinor,
        creditMinor: price.creditMinor,
      }
    : null;
}

/** The shape of a catalog file (see `apps/api/src/commerce-catalog.example.json`). */
export interface CatalogSeed {
  plans: Array<{
    key: string;
    name: string;
    position?: number;
    prices: Record<string, { amountMinor: number; creditMinor: number }>;
  }>;
  packs: Array<{
    key: string;
    name: string;
    position?: number;
    prices: Record<string, { amountMinor: number; creditMinor: number }>;
  }>;
}

const KEY = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** Checks a catalog file; returns what is wrong, or an empty list. */
export function validateCatalogSeed(seed: unknown): string[] {
  const errors: string[] = [];
  const check = (kind: string, rows: unknown) => {
    if (!Array.isArray(rows)) return errors.push(`${kind} must be a list`);
    const seen = new Set<string>();
    for (const row of rows as Array<Record<string, unknown>>) {
      const key = String(row?.key ?? "");
      if (!KEY.test(key)) errors.push(`${kind}: invalid key "${key}"`);
      if (seen.has(key)) errors.push(`${kind}: duplicate key "${key}"`);
      seen.add(key);
      if (typeof row?.name !== "string" || !row.name.trim()) errors.push(`${kind} ${key}: name`);
      const prices = row?.prices as Record<string, Record<string, unknown>> | undefined;
      if (!prices || typeof prices !== "object" || Object.keys(prices).length === 0) {
        errors.push(`${kind} ${key}: prices`);
        continue;
      }
      for (const [currency, price] of Object.entries(prices)) {
        if (!(COMMERCE_CURRENCIES as readonly string[]).includes(currency)) {
          errors.push(`${kind} ${key}: unknown currency ${currency}`);
        }
        for (const field of ["amountMinor", "creditMinor"] as const) {
          const value = price?.[field];
          if (
            !Number.isSafeInteger(value) ||
            (value as number) < 0 ||
            (value as number) > 2_000_000_000
          ) {
            errors.push(
              `${kind} ${key} ${currency}: ${field} must be a whole number of minor units`,
            );
          }
        }
      }
    }
  };
  const input = seed as Partial<CatalogSeed> | null;
  check("plans", input?.plans);
  check("packs", input?.packs ?? []);
  return errors;
}

/**
 * Writes a catalog file into the tables. Safe to repeat: a key keeps its row and its prices are
 * replaced, and nothing in the file is ever removed (set `active` off in the admin instead).
 */
export async function seedCatalog(prisma: PrismaClient, seed: CatalogSeed): Promise<void> {
  const errors = validateCatalogSeed(seed);
  if (errors.length > 0) throw new Error(`Invalid catalog: ${errors.join("; ")}`);
  for (const [index, plan] of seed.plans.entries()) {
    const row = await prisma.catalogPlan.upsert({
      where: { key: plan.key },
      create: { key: plan.key, name: plan.name, position: plan.position ?? index },
      update: { name: plan.name, position: plan.position ?? index },
    });
    for (const [currency, price] of Object.entries(plan.prices)) {
      await prisma.catalogPlanPrice.upsert({
        where: { planId_currency: { planId: row.id, currency } },
        create: { planId: row.id, currency, ...price },
        update: price,
      });
    }
  }
  for (const [index, pack] of (seed.packs ?? []).entries()) {
    const row = await prisma.catalogPack.upsert({
      where: { key: pack.key },
      create: { key: pack.key, name: pack.name, position: pack.position ?? index },
      update: { name: pack.name, position: pack.position ?? index },
    });
    for (const [currency, price] of Object.entries(pack.prices)) {
      await prisma.catalogPackPrice.upsert({
        where: { packId_currency: { packId: row.id, currency } },
        create: { packId: row.id, currency, ...price },
        update: price,
      });
    }
  }
}

export interface LockedRate {
  id: string;
  rate: string;
  rateE8: bigint;
}

/** The latest USD-to-currency rate written at or before a moment, or null when there is none. */
export async function fxRateAt(
  prisma: PrismaClient,
  quote: string,
  at: Date,
): Promise<LockedRate | null> {
  if (quote === "USD") return null;
  const row = await prisma.fxRate.findFirst({
    where: { base: "USD", quote, validFrom: { lte: at } },
    orderBy: { validFrom: "desc" },
  });
  if (!row) return null;
  const rate = row.rate.toFixed(8);
  return { id: row.id, rate, rateE8: parseRateE8(rate) };
}

/** Writes the rate for a day (a rate source or a manual override); the same day is replaced. */
export async function recordFxRate(
  prisma: PrismaClient,
  input: { quote: string; rate: string; source: string; validFrom: Date },
): Promise<void> {
  parseRateE8(input.rate);
  const validFrom = new Date(
    Date.UTC(
      input.validFrom.getUTCFullYear(),
      input.validFrom.getUTCMonth(),
      input.validFrom.getUTCDate(),
    ),
  );
  await prisma.fxRate.upsert({
    where: { base_quote_validFrom: { base: "USD", quote: input.quote, validFrom } },
    create: { base: "USD", quote: input.quote, rate: input.rate, source: input.source, validFrom },
    update: { rate: input.rate, source: input.source },
  });
}
