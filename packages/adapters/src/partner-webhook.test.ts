import { partnerWebhookSecret, signPartnerWebhook } from "@corvo/core/node/partner-key";
import type { PrismaClient } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import { createPartnerWebhookReconciler, deliverPartnerWebhook } from "./partner-webhook.js";

const KEY = "deployment-encryption-key";
const NOW = new Date("2026-11-20T12:00:00.000Z");

function fixture(
  over: {
    enabled?: boolean;
    webhookUrl?: string | null;
    deliveredAt?: Date | null;
    kind?: string;
    payload?: unknown;
    externalTenantId?: string;
  } = {},
) {
  const row = {
    id: "evt-1",
    partnerId: "partner-1",
    externalTenantId: over.externalTenantId ?? "tenant-9",
    payload: over.payload ?? null,
    kind: over.kind ?? "tenant.allowance_low",
    period: "2026-11",
    grantedCents: 1500,
    usedCents: 1260,
    createdAt: new Date("2026-11-20T11:59:00.000Z"),
    deliveredAt: over.deliveredAt ?? null,
    partner: {
      id: "partner-1",
      enabled: over.enabled ?? true,
      webhookUrl:
        over.webhookUrl === undefined ? "https://hooks.example.test/rook" : over.webhookUrl,
      webhookSecretVersion: 2,
    },
  };
  const update = vi.fn(async () => row);
  const prisma = {
    partnerWebhookEvent: { findUnique: vi.fn(async () => row), update },
  } as unknown as PrismaClient;
  return { prisma, update };
}

// A public address, so no network is needed to check the destination.
const resolveHostname = async () => [{ address: "93.184.216.34", family: 4 as const }];

function deps(f: ReturnType<typeof fixture>, fetchFn: typeof fetch) {
  return {
    prisma: f.prisma,
    encryptionKey: KEY,
    fetch: fetchFn,
    resolveHostname,
    now: () => NOW,
  };
}

describe("partner webhook delivery", () => {
  it("posts a commerce notice with its own body, in minor units and currency", async () => {
    const f = fixture({
      kind: "credit.granted",
      payload: { period: "2026-11", currency: "BRL", kind: "topup", creditMinor: 5000 },
    });
    let body = "";
    const fetchFn = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      body = String(init?.body);
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    await deliverPartnerWebhook(deps(f, fetchFn), "evt-1");
    expect(JSON.parse(body)).toEqual({
      id: "evt-1",
      type: "credit.granted",
      createdAt: "2026-11-20T11:59:00.000Z",
      externalTenantId: "tenant-9",
      period: "2026-11",
      currency: "BRL",
      kind: "topup",
      creditMinor: 5000,
    });
  });

  it("leaves the customer out of a notice that is about the partner, such as an invoice", async () => {
    const f = fixture({
      kind: "invoice.issued",
      externalTenantId: "",
      payload: { invoiceId: "i1", totalMinor: 100 },
    });
    let body = "";
    const fetchFn = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      body = String(init?.body);
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    await deliverPartnerWebhook(deps(f, fetchFn), "evt-1");
    expect(JSON.parse(body)).not.toHaveProperty("externalTenantId");
    expect(JSON.parse(body)).toMatchObject({ type: "invoice.issued", invoiceId: "i1" });
  });

  it("posts a signed notice that carries the customer's credit and no secret", async () => {
    const f = fixture();
    const seen: { url: string; headers: Headers; body: string }[] = [];
    const fetchFn = vi.fn(async (url: string | URL, init?: RequestInit) => {
      seen.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: String(init?.body),
      });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    await deliverPartnerWebhook(deps(f, fetchFn), "evt-1");

    expect(seen).toHaveLength(1);
    const { url, headers, body } = seen[0]!;
    expect(url).toBe("https://hooks.example.test/rook");
    expect(JSON.parse(body)).toEqual({
      id: "evt-1",
      type: "tenant.allowance_low",
      createdAt: "2026-11-20T11:59:00.000Z",
      externalTenantId: "tenant-9",
      period: "2026-11",
      grantedCents: 1500,
      usedCents: 1260,
      remainingCents: 240,
    });
    const timestamp = headers.get("x-rook-timestamp")!;
    expect(timestamp).toBe(String(Math.floor(NOW.getTime() / 1000)));
    const secret = partnerWebhookSecret(KEY, "partner-1", 2);
    expect(headers.get("x-rook-signature")).toBe(signPartnerWebhook(secret, timestamp, body));
    expect(headers.get("x-rook-event")).toBe("tenant.allowance_low");
    expect(headers.get("x-rook-delivery")).toBe("evt-1");
    // Nothing secret goes out, in the body or the headers.
    const everything = `${body} ${[...headers.entries()].flat().join(" ")}`;
    expect(everything).not.toContain(secret);
    expect(everything).not.toContain(KEY);
    expect(f.update).toHaveBeenCalledWith({ where: { id: "evt-1" }, data: { deliveredAt: NOW } });
  });

  it("fails, so the queue retries, when the partner answers an error, and records nothing", async () => {
    const f = fixture();
    const fetchFn = vi.fn(
      async () => new Response("no", { status: 503 }),
    ) as unknown as typeof fetch;
    await expect(deliverPartnerWebhook(deps(f, fetchFn), "evt-1")).rejects.toThrow(/503/);
    expect(f.update).not.toHaveBeenCalled();
  });

  it("fails when the partner cannot be reached, and succeeds on the next try", async () => {
    const f = fixture();
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("connection reset");
      return new Response("ok");
    }) as unknown as typeof fetch;
    await expect(deliverPartnerWebhook(deps(f, fetchFn), "evt-1")).rejects.toThrow();
    await deliverPartnerWebhook(deps(f, fetchFn), "evt-1");
    expect(f.update).toHaveBeenCalledTimes(1);
  });

  it("refuses a private or plain-http address instead of calling it", async () => {
    for (const webhookUrl of [
      "http://hooks.example.test/x",
      "https://169.254.169.254/x",
      "https://10.0.0.5/x",
    ]) {
      const f = fixture({ webhookUrl });
      const fetchFn = vi.fn() as unknown as typeof fetch;
      await expect(deliverPartnerWebhook(deps(f, fetchFn), "evt-1")).rejects.toThrow();
      expect(fetchFn).not.toHaveBeenCalled();
    }
  });

  it("sends nothing for a notice already delivered, or a partner that is off or has no webhook", async () => {
    for (const over of [
      { deliveredAt: NOW },
      { enabled: false },
      { webhookUrl: null },
      { kind: "something.else" },
    ]) {
      const f = fixture(over);
      const fetchFn = vi.fn() as unknown as typeof fetch;
      await deliverPartnerWebhook(deps(f, fetchFn), "evt-1");
      expect(fetchFn).not.toHaveBeenCalled();
      expect(f.update).not.toHaveBeenCalled();
    }
  });
});

describe("partner webhook reconciler", () => {
  it("queues each new notice once under its own key, with a bounded number of attempts", async () => {
    const enqueue = vi.fn(async () => undefined);
    const prisma = {
      partner: { findMany: vi.fn(async () => []) },
      partnerWebhookEvent: { findMany: vi.fn(async () => [{ id: "lost-1" }]) },
    } as unknown as PrismaClient;
    await createPartnerWebhookReconciler({ prisma, jobs: { enqueue }, now: () => NOW })();
    expect(enqueue).toHaveBeenCalledWith({
      name: "partner.webhook",
      payload: { eventId: "lost-1" },
      replaceKey: "partner-webhook:lost-1",
      maxAttempts: 8,
      keepExisting: true,
    });
  });
});
