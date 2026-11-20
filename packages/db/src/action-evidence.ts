import type { Prisma } from "./generated/prisma/client.js";

const KINDS = {
  "computer.command": "command",
  "agent.tool.called": "tool_called",
  "agent.tool.completed": "tool_completed",
} as const;

const text = (value: unknown) => (typeof value === "string" ? value : null);

/**
 * Copies a recorded command or tool call into the append-only evidence, in the transaction that
 * records the event. Done here and not by a trigger because event payloads are sealed in the
 * database. Keeps ids, the command line or tool name and the outcome, never output, arguments or
 * results. Other event types do nothing.
 */
export async function recordActionEvidence(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  event: {
    id: string;
    type: string;
    spaceId: string;
    threadId: string;
    botId: string;
    runId: string | null;
    createdAt: Date;
  },
  payload: unknown,
): Promise<void> {
  const kind = KINDS[event.type as keyof typeof KINDS];
  if (!kind) return;
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const command = event.type === "computer.command";
  const exitCode = command && Number.isInteger(p.exitCode) ? (p.exitCode as number) : null;
  await tx.$executeRaw`
    INSERT INTO "action_evidence"
      ("id", "spaceId", "organizationId", "botId", "computerId", "runId", "userId", "kind",
       "executionId", "detail", "cwd", "status", "exitCode", "occurredAt")
    SELECT ${event.id}, ${event.spaceId},
      (SELECT "organizationId" FROM "spaces" WHERE "id" = ${event.spaceId}),
      ${event.botId},
      (SELECT "computerId" FROM "bots" WHERE "id" = ${event.botId}),
      ${event.runId}::text,
      COALESCE(
        (SELECT "userId" FROM "runs" WHERE "id" = ${event.runId}::text),
        (SELECT "userId" FROM "threads" WHERE "id" = ${event.threadId})),
      ${kind}, ${text(p.executionId)},
      ${command ? text(p.command) : text(p.name)},
      ${command ? text(p.cwd) : null},
      ${command ? text(p.status) : event.type === "agent.tool.completed" ? text(p.outcome) : null},
      ${exitCode}::int, ${event.createdAt}::timestamp(3)
    ON CONFLICT ("id") DO NOTHING`;
}
