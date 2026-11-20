import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";

/** Most action rows a report carries; past it the report says so instead of growing without bound. */
export const EVIDENCE_ACTION_LIMIT = 100_000;

const LEDGER_KINDS = [
  "baseline",
  "purchase",
  "reservation",
  "settlement",
  "refund",
  "correction",
  "account_closed",
];

type Row = Record<string, string | number | boolean | null>;

export interface UsageEvidenceReport {
  organizationId: string;
  /** Inclusive. */
  from: string;
  /** Exclusive. */
  to: string;
  generatedAt: string;
  /** The subscription as last synced; null once the organization is deleted. */
  subscription: Row | null;
  /** Payment and subscription events the provider sent in the range. */
  billingEvents: Row[];
  termsAcceptances: Row[];
  /** One row per call, with its latest corrected figures. */
  modelCalls: Row[];
  creditLedger: Row[];
  computerRuns: Row[];
  resourceSamples: Row[];
  /** Commands and tool calls the agents made, from the evidence kept when they were recorded; no output. */
  actions: Row[];
  actionsTruncated: boolean;
  /**
   * Bytes stored: the daily snapshot at or before the period's last day (null before the first
   * snapshot), and the live total, which is null once the organization is deleted.
   */
  storage: {
    snapshotDay: string | null;
    snapshotBytes: string | null;
    currentBytes: string | null;
    reconciledAt: string | null;
  };
}

type Json = Record<string, unknown>;
const str = (value: unknown) => (typeof value === "string" ? value : null);
const num = (value: unknown) => (typeof value === "number" ? value : null);
/** A journal timestamp is a naive UTC string. */
const utc = (value: unknown) =>
  typeof value === "string" ? new Date(`${value}Z`).toISOString() : null;

/**
 * What an organization used and paid for in a range: payments and accepted terms, every model
 * call, credit movements, computer runs with duration, resource samples and what the agents did
 * on the computers. Built from rows that survive the deletion of users, bots, spaces and the
 * organization itself. Run as the system.
 */
export async function usageEvidenceReport(
  prisma: PrismaClient,
  input: { organizationId: string; from: Date; to: Date },
  now = new Date(),
): Promise<UsageEvidenceReport> {
  const { organizationId, from, to } = input;
  const inRange = { gte: from, lt: to };

  const [account, journal, calls, runs, samples, actions, usage, snapshot] = await Promise.all([
    prisma.billingAccount.findUnique({ where: { organizationId } }),
    prisma.billingAuditEvent.findMany({
      where: { organizationId, createdAt: inRange },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.$queryRaw<{ details: Json }[]>(Prisma.sql`
      SELECT DISTINCT ON (e.details->>'id') e.details
      FROM billing_audit_events e
      WHERE e."organizationId" = ${organizationId}
        AND e.kind IN ('usage', 'usage_correction')
        AND e.details->>'id' IN (
          SELECT i.details->>'id' FROM billing_audit_events i
          WHERE i."organizationId" = ${organizationId} AND i.kind = 'usage'
            AND (i.details->>'createdAt')::timestamp >= ${from}::timestamp
            AND (i.details->>'createdAt')::timestamp < ${to}::timestamp)
      ORDER BY e.details->>'id', (e.details->>'auditRevision')::int DESC`),
    prisma.computerRun.findMany({
      where: {
        organizationId,
        startedAt: { lt: to },
        OR: [{ endedAt: null }, { endedAt: { gte: from } }],
      },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    }),
    prisma.computerResourceSample.findMany({
      where: { organizationId, sampledAt: inRange },
      orderBy: [{ sampledAt: "asc" }, { id: "asc" }],
    }),
    prisma.actionEvidence.findMany({
      where: { organizationId, occurredAt: inRange },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: EVIDENCE_ACTION_LIMIT + 1,
    }),
    prisma.storageUsage.findUnique({ where: { organizationId } }),
    prisma.storageSnapshot.findFirst({
      where: {
        organizationId,
        day: { lte: new Date(to.getTime() - 1).toISOString().slice(0, 10) },
      },
      orderBy: { day: "desc" },
    }),
  ]);

  const stripe = journal.filter((event) => event.kind.startsWith("stripe."));
  const detail = (event: { details: unknown }) => event.details as Json;
  const finished = (run: { startedAt: Date; endedAt: Date | null }) =>
    ((run.endedAt ?? now).getTime() - run.startedAt.getTime()) / 1000;

  return {
    organizationId,
    from: from.toISOString(),
    to: to.toISOString(),
    generatedAt: now.toISOString(),
    subscription: account
      ? {
          customerId: account.customerId,
          subscriptionId: account.subscriptionId,
          priceLookupKey: account.priceLookupKey,
          currency: account.currency,
          interval: account.interval,
          status: account.status,
          seats: account.seats,
          subscribedAt: account.subscribedAt?.toISOString() ?? null,
          endedAt: account.endedAt?.toISOString() ?? null,
        }
      : null,
    billingEvents: stripe.map((event) => {
      const d = detail(event);
      return {
        time: event.createdAt.toISOString(),
        kind: event.kind,
        eventId: str(d.eventId),
        amountMinor: num(d.amountMinor),
        currency: event.currency,
        priceLookupKeys: Array.isArray(d.priceLookupKeys) ? d.priceLookupKeys.join(" ") : null,
        interval: str(d.interval),
        status: str(d.status),
        subscriptionId: str(d.subscriptionId),
        invoiceId: str(d.invoiceId),
        chargeId: str(d.chargeId),
        sessionId: str(d.sessionId),
        customerId: str(d.customerId),
      };
    }),
    termsAcceptances: journal
      .filter((event) => event.kind === "terms_accepted")
      .map((event) => ({
        time: event.createdAt.toISOString(),
        termsVersion: str(detail(event).termsVersion),
        sessionId: str(detail(event).sessionId),
        customerId: str(detail(event).customerId),
      })),
    modelCalls: calls
      .map(({ details: d }) => ({
        callTime: utc(d.createdAt),
        id: str(d.id),
        callId: str(d.callId),
        userId: str(d.userId),
        botId: str(d.botId),
        spaceId: str(d.spaceId),
        runId: str(d.runId),
        provider: str(d.provider),
        model: str(d.model),
        inputTokens: num(d.inputTokens),
        outputTokens: num(d.outputTokens),
        cacheReadTokens: num(d.cacheReadTokens),
        cacheWriteTokens: num(d.cacheWriteTokens),
        totalTokens: num(d.totalTokens),
        costUsd: num(d.costUsd),
        providerRequestId: str(d.providerRequestId),
        revision: num(d.auditRevision),
      }))
      .sort((a, b) => `${a.callTime}${a.id}`.localeCompare(`${b.callTime}${b.id}`)),
    creditLedger: journal
      .filter((event) => LEDGER_KINDS.includes(event.kind))
      .map((event) => ({
        time: event.createdAt.toISOString(),
        kind: event.kind,
        source: event.source,
        amountMicros: event.amountMicros.toString(),
        callId: event.callId,
        userId: event.userId,
        spaceId: event.spaceId,
        provider: event.provider,
        model: event.model,
        providerRequestId: event.providerRequestId,
      })),
    computerRuns: runs.map((run) => ({
      computerId: run.computerId,
      spaceId: run.spaceId,
      userId: run.userId,
      kind: run.kind,
      providerRef: run.providerRef,
      startedAt: run.startedAt.toISOString(),
      endedAt: run.endedAt?.toISOString() ?? null,
      endReason: run.endReason,
      open: run.endedAt === null,
      durationSeconds: finished(run),
    })),
    resourceSamples: samples.map((sample) => ({
      time: sample.sampledAt.toISOString(),
      computerId: sample.computerId,
      spaceId: sample.spaceId,
      userId: sample.userId,
      reason: sample.reason,
      cpuSeconds: sample.cpuSeconds,
      memoryBytes: sample.memoryBytes?.toString() ?? null,
      diskBytes: sample.diskBytes?.toString() ?? null,
      networkRxBytes: sample.networkRxBytes?.toString() ?? null,
      networkTxBytes: sample.networkTxBytes?.toString() ?? null,
    })),
    actions: actionRows(actions.slice(0, EVIDENCE_ACTION_LIMIT)),
    actionsTruncated: actions.length > EVIDENCE_ACTION_LIMIT,
    storage: {
      snapshotDay: snapshot?.day ?? null,
      snapshotBytes: snapshot?.bytes.toString() ?? null,
      currentBytes: usage?.bytes.toString() ?? null,
      reconciledAt: usage?.reconciledAt?.toISOString() ?? null,
    },
  };
}

/** One row per command or tool call: a command's last state, a tool's call joined to its outcome. */
function actionRows(
  rows: {
    kind: string;
    executionId: string | null;
    occurredAt: Date;
    spaceId: string;
    botId: string;
    computerId: string | null;
    runId: string | null;
    userId: string | null;
    detail: string | null;
    cwd: string | null;
    status: string | null;
    exitCode: number | null;
  }[],
): Row[] {
  const merged = new Map<string, Row>();
  const out: Row[] = [];
  for (const row of rows) {
    const kind = row.kind === "command" ? "command" : "tool";
    const key = row.executionId ? `${kind}:${row.botId}:${row.executionId}` : null;
    const found = key ? merged.get(key) : undefined;
    if (found) {
      // A command that finished stays finished; a tool's outcome comes from its completion.
      if (kind === "command" && found.status === "done" && row.status === "running") continue;
      found.status = row.status ?? found.status ?? null;
      found.exitCode = row.exitCode ?? found.exitCode ?? null;
      found.detail = row.detail ?? found.detail ?? null;
      continue;
    }
    const entry: Row = {
      time: row.occurredAt.toISOString(),
      kind,
      computerId: row.computerId,
      spaceId: row.spaceId,
      botId: row.botId,
      userId: row.userId,
      runId: row.runId,
      executionId: row.executionId,
      detail: row.detail,
      cwd: row.cwd,
      status: row.status,
      exitCode: row.exitCode,
    };
    if (key) merged.set(key, entry);
    out.push(entry);
  }
  return out;
}

const csvCell = (value: unknown) => {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // A cell that starts like a formula would run in a spreadsheet; commands and ids come from users.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** Each section of the report as its own block: a `# name` line, a header, then the rows. */
export function usageEvidenceCsv(report: UsageEvidenceReport): string {
  const meta: Row[] = [
    {
      organizationId: report.organizationId,
      from: report.from,
      to: report.to,
      generatedAt: report.generatedAt,
      actionsTruncated: report.actionsTruncated,
      storageCurrentBytes: report.storage.currentBytes,
      storageSnapshotDay: report.storage.snapshotDay,
      storageSnapshotBytes: report.storage.snapshotBytes,
    },
  ];
  const sections: [string, Row[]][] = [
    ["report", meta],
    ["subscription", report.subscription ? [report.subscription] : []],
    ["billingEvents", report.billingEvents],
    ["termsAcceptances", report.termsAcceptances],
    ["modelCalls", report.modelCalls],
    ["creditLedger", report.creditLedger],
    ["computerRuns", report.computerRuns],
    ["resourceSamples", report.resourceSamples],
    ["actions", report.actions],
  ];
  return `${sections
    .map(([name, rows]) => {
      const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
      return [
        `# ${name}`,
        ...(rows.length
          ? [columns.join(","), ...rows.map((row) => columns.map((c) => csvCell(row[c])).join(","))]
          : []),
      ].join("\n");
    })
    .join("\n\n")}\n`;
}
