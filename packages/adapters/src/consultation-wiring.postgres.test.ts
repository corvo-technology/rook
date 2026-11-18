import { randomUUID } from "node:crypto";
import type {
  AgentRunModel,
  AgentRuntime,
  ConnectorCall,
  ConnectorEvent,
  VoiceProvider,
} from "@corvo/adapter-kit";
import type { PrismaClient } from "@corvo/db";
import {
  addConsultationChunk,
  asSystem,
  createConsultation,
  createDb,
  createPartner,
  createRepos,
  provisionPartnerTenant,
  reconcileCreditPurchase,
  runAsSystem,
  runAsTenant,
  startConsultationProcessing,
} from "@corvo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createConsultationProcessor,
  createConsultationRetentionSweeper,
  deleteConsultationContent,
} from "./consultation-wiring.js";

// Needs DATABASE_URL as the runtime login (row security applies to it).
const url = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE === "1" && url ? describe.sequential : describe.skip;

describePostgres("consultation processing and retention (PostgreSQL, runtime login)", () => {
  const stamp = `${process.pid}-${Date.now()}`;
  let db: ReturnType<typeof createDb>;
  let system: PrismaClient;
  const partnerIds: string[] = [];
  const orgIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(() => {
    db = createDb(url!);
    system = asSystem(db.prisma);
  });
  afterAll(async () => {
    await system.partner.deleteMany({ where: { id: { in: partnerIds } } });
    await system.organization.deleteMany({ where: { id: { in: orgIds } } });
    await system.user.deleteMany({ where: { id: { in: userIds } } });
    await db.prisma.$disconnect();
    await db.pool.end();
  });

  async function customer(label: string, options: { credit: boolean }) {
    const prisma = db.prisma;
    const made = await runAsSystem("consultation fixture", async () => {
      const { partner } = await createPartner(prisma, {
        slug: `scribe-${label}-${stamp}`,
        name: label,
      });
      partnerIds.push(partner.id);
      const tenant = await provisionPartnerTenant(prisma, partner, {
        externalTenantId: `shop-${label}`,
        name: label,
      });
      orgIds.push(tenant.organizationId);
      userIds.push(tenant.ownerUserId);
      if (options.credit) {
        await reconcileCreditPurchase(prisma, tenant.organizationId, {
          id: `scribe-${label}-${stamp}`,
          amountCents: 500,
          expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        });
      }
      return { partner, tenant };
    });
    const scope = { spaceId: made.tenant.spaceId, userId: made.tenant.ownerUserId };
    const actor = { ...scope, email: "owner@partner.invalid", isDeploymentOwner: false };
    const { botId, serverId } = await runAsTenant(scope, async () => {
      const bot = await createRepos(prisma).createBot(actor, {
        name: "Escriba",
        title: "",
        description: "",
        instructions: "Write notes.",
        notifyOnFinish: true,
        computerMode: "team",
        spawnKey: `partner:${made.partner.id}:escriba`,
      });
      const server = await prisma.mcpServer.create({
        data: {
          spaceId: scope.spaceId,
          userId: scope.userId,
          slug: "greenflow",
          name: "Greenflow",
          description: "",
          transport: "streamable_http",
          endpoint: "https://mcp.greenflow.example/mcp",
        },
      });
      await prisma.botMcpServer.create({
        data: {
          spaceId: scope.spaceId,
          userId: scope.userId,
          botId: bot.id,
          serverId: server.id,
        },
      });
      return { botId: bot.id, serverId: server.id };
    });
    const consultation = await runAsSystem("consultation fixture", async () => {
      const row = await createConsultation(prisma, {
        partnerId: made.partner.id,
        tenantId: made.tenant.tenantId,
        externalUserId: "doctor-1",
        template: "prontu_evolution",
        context: { clientId: "client-1", appointmentId: "appt-1", clientName: "Maria Souza" },
        consent: { obtained: true, at: "2026-12-01T10:00:00Z", method: "verbal", text: "Sim" },
        retentionDays: 30,
      });
      for (const seq of [0, 1]) {
        await addConsultationChunk(
          prisma,
          row.id,
          { seq, artifactId: `object:chunk-${label}-${seq}`, size: 2, mimeType: "audio/webm" },
          { maxChunks: 10, maxBytes: 1000 },
        );
      }
      await startConsultationProcessing(prisma, row.id);
      return row;
    });
    return { ...made, scope, botId, serverId, consultation };
  }

  function harness(label: string, over: { transcribe?: VoiceProvider["transcribe"] } = {}) {
    const objects = new Map<string, Uint8Array>([
      [`object:chunk-${label}-0`, new Uint8Array([1, 1])],
      [`object:chunk-${label}-1`, new Uint8Array([2, 2])],
    ]);
    const artifacts = {
      get: vi.fn(async (id: string) => {
        const found = objects.get(id);
        if (!found) throw new Error("missing");
        return found;
      }),
      put: vi.fn(async (artifact: { bytes: Uint8Array }) => {
        const id = `object:${randomUUID()}`;
        objects.set(id, artifact.bytes);
        return { id, hash: "" };
      }),
      remove: vi.fn(async (id: string) => {
        objects.delete(id);
      }),
    };
    const requests: Array<{ botId: string; instructions: string }> = [];
    const runtime = {
      describe: () => ({
        id: "fake",
        contractVersion: "1",
        adapterVersion: "1",
        capabilities: {},
      }),
      abort: async () => undefined,
      async *run(request: { botId: string; instructions: string }) {
        requests.push({ botId: request.botId, instructions: request.instructions });
        const labels = request.instructions.includes("speaker-labels");
        yield {
          type: "done",
          text: labels
            ? '["p","c"]'
            : JSON.stringify({ title: "Consulta", notes: "Paciente com enxaqueca." }),
        };
      },
    } as unknown as AgentRuntime;
    const calls: Array<{ call: ConnectorCall; botId?: string }> = [];
    const connector = {
      async *execute(
        call: ConnectorCall,
        context: { botId?: string },
      ): AsyncIterable<ConnectorEvent> {
        calls.push({ call, botId: context.botId });
        yield {
          type: "result",
          data: {
            structuredContent:
              call.route?.toolName === "mcp_records_get_by_client"
                ? { recordId: "rec-1" }
                : { entryId: "entry-1" },
          },
        };
      },
    };
    const transcribe = vi.fn(
      over.transcribe ??
        (async () => ({
          text: "Bom dia. Estou com enxaqueca desde ontem à noite.",
          costUsd: 0.01,
        })),
    );
    const strongModel = { provider: "strong-provider", id: "strong" } as AgentRunModel;
    const resolveStrongModel = vi.fn(async () => strongModel);
    const process = createConsultationProcessor({
      prisma: db.prisma,
      artifacts,
      runtime,
      secretStore: { load: async () => "" },
      resolveModel: async () => ({ provider: "main-provider", id: "main" }) as AgentRunModel,
      resolveFastModel: async () => undefined,
      resolveStrongModel,
      connector: connector as never,
      voiceCredits: { apiKey: "deployment-key", metered: true },
      createVoiceProvider: (() => ({ transcribe })) as never,
    });
    return { objects, artifacts, requests, calls, transcribe, process, resolveStrongModel };
  }

  it("runs as the customer: drafts through the Escriba's connector and charges the customer's credit", async () => {
    const fx = await customer("happy", { credit: true });
    const h = harness("happy");
    await h.process(fx.consultation.id);

    const row = await system.consultation.findUniqueOrThrow({ where: { id: fx.consultation.id } });
    expect(row).toMatchObject({ state: "drafted", draftEntryId: "entry-1", errorCode: null });
    expect(row.resultArtifactId).toBeTruthy();
    expect(h.calls.map((c) => c.call.route?.toolName)).toEqual([
      "mcp_records_get_by_client",
      "mcp_records_entries_create_draft",
    ]);
    // The tools run on the Escriba's connector, as that agent.
    for (const { call, botId } of h.calls) {
      expect(call.route).toMatchObject({ connectorId: "mcp", resourceId: fx.serverId });
      expect(botId).toBe(fx.botId);
    }
    expect(h.calls[1]?.call.args).toMatchObject({
      recordId: "rec-1",
      entryTypeCode: "evolution",
      source: "ai_scribe",
      consultationId: fx.consultation.id,
      appointmentId: "appt-1",
    });
    // The strong tier wrote the note, and the usage belongs to the Escriba.
    expect(h.resolveStrongModel).toHaveBeenCalledWith({
      spaceId: fx.scope.spaceId,
      userId: fx.scope.userId,
    });
    expect(h.requests.every((r) => r.botId === fx.botId)).toBe(true);
    // Transcription was paid from the customer's own credit, and settled at the reported cost.
    const spent = await system.modelCreditEntry.findMany({
      where: { organizationId: fx.tenant.organizationId, provider: "openrouter" },
    });
    expect(spent).toHaveLength(1);
    expect(spent[0]).toMatchObject({ pending: false });
  });

  it("fails with credit_exhausted, before calling the provider, when the customer has no credit", async () => {
    const fx = await customer("broke", { credit: false });
    const h = harness("broke");
    await h.process(fx.consultation.id);
    const row = await system.consultation.findUniqueOrThrow({ where: { id: fx.consultation.id } });
    expect(row).toMatchObject({ state: "failed", errorCode: "credit_exhausted" });
    expect(h.transcribe).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
  });

  it("deletes on request: sealed objects first, then the references, with no audit of its own", async () => {
    const fx = await customer("delete", { credit: true });
    const h = harness("delete");
    await h.process(fx.consultation.id);
    const before = [...h.objects.keys()].length;
    expect(before).toBeGreaterThanOrEqual(3);
    await runAsSystem("test", () =>
      deleteConsultationContent(
        { prisma: db.prisma, artifacts: h.artifacts },
        fx.consultation.id,
        null,
      ),
    );
    expect(h.objects.size).toBe(0);
    const row = await system.consultation.findUniqueOrThrow({ where: { id: fx.consultation.id } });
    expect(row.purgedAt).not.toBeNull();
    expect(row.resultArtifactId).toBeNull();
    expect(JSON.stringify(row.context)).not.toContain("Maria");
    await expect(
      system.consultationChunk.count({ where: { consultationId: row.id } }),
    ).resolves.toBe(0);
  });

  it("keeps the references when an object cannot be deleted, and finishes on the next sweep", async () => {
    const fx = await customer("sweep", { credit: true });
    const h = harness("sweep");
    await h.process(fx.consultation.id);
    await system.consultation.update({
      where: { id: fx.consultation.id },
      data: { retentionDays: 1, finishedAt: new Date(Date.now() - 3 * 86_400_000) },
    });
    const failing = vi.fn(async () => {
      throw new Error("storage down");
    });
    await createConsultationRetentionSweeper({
      prisma: db.prisma,
      artifacts: { remove: failing },
      intervalMs: 0,
    })();
    expect(failing).toHaveBeenCalled();
    let row = await system.consultation.findUniqueOrThrow({ where: { id: fx.consultation.id } });
    expect(row.purgedAt).not.toBeNull();
    await expect(
      system.consultationChunk.count({ where: { consultationId: row.id } }),
    ).resolves.toBeGreaterThan(0);

    await createConsultationRetentionSweeper({
      prisma: db.prisma,
      artifacts: h.artifacts,
      intervalMs: 0,
    })();
    expect(h.objects.size).toBe(0);
    row = await system.consultation.findUniqueOrThrow({ where: { id: fx.consultation.id } });
    expect(row.resultArtifactId).toBeNull();
    await expect(
      system.consultationChunk.count({ where: { consultationId: row.id } }),
    ).resolves.toBe(0);
  });

  it("leaves a consultation inside its retention alone and fails one stuck in processing", async () => {
    const fresh = await customer("fresh", { credit: true });
    const stuck = await customer("stuck", { credit: true });
    await system.consultation.update({
      where: { id: stuck.consultation.id },
      data: { finishedAt: new Date(Date.now() - 3 * 3_600_000) },
    });
    const remove = vi.fn(async () => undefined);
    await createConsultationRetentionSweeper({
      prisma: db.prisma,
      artifacts: { remove },
      intervalMs: 0,
    })();
    expect(remove).not.toHaveBeenCalled();
    await expect(
      system.consultation.findUniqueOrThrow({ where: { id: fresh.consultation.id } }),
    ).resolves.toMatchObject({ purgedAt: null, state: "processing" });
    await expect(
      system.consultation.findUniqueOrThrow({ where: { id: stuck.consultation.id } }),
    ).resolves.toMatchObject({ state: "failed", errorCode: "internal" });
  });
});
