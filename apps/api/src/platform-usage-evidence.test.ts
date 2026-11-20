import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { RPCHandler } from "@orpc/server/fetch";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const report = vi.hoisted(() => vi.fn());
vi.mock("@corvo/db", async (original) => ({
  ...(await original<typeof import("@corvo/db")>()),
  usageEvidenceReport: report,
}));

// Offline boundary: the real router and operator gate, with the report itself stubbed.
function setup(email: string) {
  report.mockReset();
  report.mockResolvedValue({
    organizationId: "org-1",
    from: "",
    to: "",
    generatedAt: "",
    subscription: null,
    billingEvents: [],
    termsAcceptances: [],
    modelCalls: [{ callTime: "2026-03-05T10:00:00.000Z", id: "u1" }],
    creditLedger: [],
    computerRuns: [],
    resourceSamples: [],
    actions: [],
    actionsTruncated: false,
    storage: { currentBytes: null, reconciledAt: null, objectBytesAtPeriodEnd: "0" },
  });
  const deps = {
    prisma: {} as PrismaClient,
    events: { notify: vi.fn(async () => undefined) },
    env: {
      defaultProvider: "fake",
      defaultModel: "fake-model",
      webOrigin: "http://127.0.0.1:5173",
      screenProxySecret: "fake-test-secret",
      sandboxProvider: "fake",
      partnerAdminEmails: ["boss@corvo.test"],
    },
    dataDir: "/tmp/corvo-router-test",
  } as unknown as RouterDeps;
  const handler = new RPCHandler(createRouter(deps));
  return async (input: unknown) => {
    const { response } = await handler.handle(
      new Request("http://127.0.0.1/rpc/platform/usageEvidence/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: input }),
      }),
      {
        prefix: "/rpc",
        context: {
          actor: {
            spaceId: "space-1",
            userId: "op-1",
            email,
            isDeploymentOwner: false,
          } satisfies Actor,
        },
      },
    );
    const text = await response!.text();
    return { status: response!.status, body: text ? JSON.parse(text).json : undefined };
  };
}

const range = { organizationId: "org-1", from: "2026-03-01", to: "2026-03-31" };

describe("platform.usageEvidence.export", () => {
  it("is closed to anyone outside the operator list", async () => {
    const call = setup("someone@corvo.test");
    expect((await call({ ...range, format: "csv" })).status).toBe(404);
    expect(report).not.toHaveBeenCalled();
  });

  it("builds the report for the days asked, the last day included", async () => {
    const call = setup("boss@corvo.test");
    const csv = await call({ ...range, format: "csv" });
    expect(csv.body).toMatchObject({
      filename: "usage-evidence-org-1-2026-03-01-2026-03-31.csv",
      contentType: "text/csv",
    });
    expect(csv.body.content).toContain("# modelCalls");
    expect(report).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      from: new Date("2026-03-01T00:00:00.000Z"),
      to: new Date("2026-04-01T00:00:00.000Z"),
    });
    const json = await call({ ...range, format: "json" });
    expect(JSON.parse(json.body.content).modelCalls).toHaveLength(1);
  });

  it("refuses a backwards or oversized range", async () => {
    const call = setup("boss@corvo.test");
    expect((await call({ ...range, from: "2026-04-02", format: "json" })).status).toBe(400);
    expect((await call({ ...range, from: "2024-01-01", format: "json" })).status).toBe(400);
    expect(report).not.toHaveBeenCalled();
  });
});
