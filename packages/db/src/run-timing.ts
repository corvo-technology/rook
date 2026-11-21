import type { MessageBlock } from "@corvo/contracts";
import { isBackgroundRunTrigger } from "@corvo/core";
import type { PrismaClient } from "./client.js";

const RESPONSE_BLOCK_KINDS = new Set<string>([
  "card",
  "chart",
  "ask",
  "choice",
  "app_connect",
  "host_action",
  "connect",
  "computer",
  "voice_call",
  "call_request",
  "image",
  "file",
  "handoff",
  "skill_draft",
  "mcp_approval",
  "child_bot",
  "cloud_agent",
] satisfies MessageBlock["kind"][]);

/** Only actual reply output counts; working/activity placeholders do not. */
export function isRunResponse(type: string, payload: Record<string, unknown>): boolean {
  if (type === "thread.progress") {
    return (
      payload.streaming === true &&
      payload.activity !== true &&
      [payload.text, payload.delta].some(
        (value) => typeof value === "string" && value.trim().length > 0,
      )
    );
  }
  if (type !== "thread.message.created" || payload.role !== "bot" || !Array.isArray(payload.blocks))
    return false;
  return payload.blocks.some((block: unknown) => {
    if (!block || typeof block !== "object" || !("kind" in block)) return false;
    if (block.kind === "text")
      return "text" in block && typeof block.text === "string" && block.text.trim().length > 0;
    return typeof block.kind === "string" && RESPONSE_BLOCK_KINDS.has(block.kind);
  });
}

/**
 * The first sign of life a person sees: the run starting, or a tool activity line. Background
 * (ticket) runs show nothing, so they never count.
 */
export function isRunActivity(type: string, payload: Record<string, unknown>): boolean {
  if (type === "run.started") return !isBackgroundRunTrigger(payload.trigger as string | undefined);
  return (
    type === "thread.progress" &&
    payload.activity === true &&
    typeof payload.text === "string" &&
    payload.text.trim().length > 0
  );
}

export function runTimingFields(run: {
  trigger: string;
  createdAt: Date;
  startedAt: Date | null;
  firstResponseAt: Date | null;
  firstActivityAt?: Date | null;
  completedAt: Date | null;
  sourceMessage: { createdAt: Date } | null;
}): Record<string, string | number> {
  const origin = run.sourceMessage?.createdAt ?? run.createdAt;
  const elapsed = (end: Date, start: Date) => Math.max(0, end.getTime() - start.getTime());
  return {
    "run.trigger": run.trigger,
    "run.pre_run_wait_ms": elapsed(run.createdAt, origin),
    ...(run.startedAt ? { "run.queue_wait_ms": elapsed(run.startedAt, run.createdAt) } : {}),
    ...(run.firstActivityAt
      ? { "run.first_activity_ms": elapsed(run.firstActivityAt, origin) }
      : {}),
    ...(run.firstResponseAt
      ? { "run.first_response_ms": elapsed(run.firstResponseAt, origin) }
      : {}),
    ...(run.completedAt
      ? {
          "run.total_ms": elapsed(run.completedAt, origin),
          ...(run.startedAt
            ? { "run.execution_wall_ms": elapsed(run.completedAt, run.startedAt) }
            : {}),
        }
      : {}),
  };
}

/** Observability failures must never fail a committed user operation. */
export async function readRunTimingFields(prisma: PrismaClient, runId: string) {
  try {
    const run = await prisma.run.findUnique({
      where: { id: runId },
      select: {
        trigger: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        firstResponseAt: true,
        firstActivityAt: true,
        sourceMessage: { select: { createdAt: true } },
      },
    });
    return run ? runTimingFields(run) : {};
  } catch {
    return {};
  }
}
