import type { AdapterContext } from "@corvo/adapter-kit";
import type { ExecutorDeps } from "./executor-deps.js";
import {
  countRepeatedRequests,
  MAX_EARLIER_REQUESTS,
  REPEATS_BEFORE_OFFER,
  renderRepeatHint,
} from "./repeat-requests.js";
import type { DecisionScope } from "./run-decisions.js";
import { decisionChooserOrRunModel } from "./run-decisions.js";

const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A line for the bot's context when the owner has asked for this kind of thing before, so
 * it can offer to make it a routine. Nothing when the history is short or the judge fails.
 */
export async function repeatHintForRun(
  deps: ExecutorDeps,
  scope: DecisionScope,
  input: {
    request: string;
    sourceMessageId: string;
    own: { provider: string; modelId: string; credentialId?: string };
    context: AdapterContext & { signal: AbortSignal };
    registerSecrets?: (values: string[]) => void;
  },
): Promise<string | undefined> {
  if (!input.request.trim()) return undefined;
  try {
    const rows = await deps.prisma.message.findMany({
      where: {
        threadId: scope.threadId,
        role: "user",
        id: { not: input.sourceMessageId },
        createdAt: { gte: new Date(Date.now() - LOOKBACK_MS) },
        sourceRuns: { some: { trigger: "user" } },
      },
      orderBy: { seq: "desc" },
      take: MAX_EARLIER_REQUESTS,
      select: { blocks: true },
    });
    const earlier = rows
      .map((row) =>
        ((row.blocks ?? []) as { kind: string; text?: string }[])
          .flatMap((block) => (block.kind === "text" && block.text ? [block.text] : []))
          .join("\n"),
      )
      .filter((text) => text.trim());
    if (earlier.length < REPEATS_BEFORE_OFFER) return undefined;
    const chooser = await decisionChooserOrRunModel(
      deps,
      scope,
      "repeat",
      input.own,
      input.registerSecrets,
    );
    if (!chooser) return undefined;
    const repeats = await countRepeatedRequests(
      { ...chooser, request: input.request, earlier },
      input.context,
    );
    return repeats >= REPEATS_BEFORE_OFFER ? renderRepeatHint(repeats) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Starts the repeat judge beside the rest of the turn's preparation and returns a reader for what
 * it has found by then. The first model call never waits for it: a hint that is not ready is
 * left out of this turn, and the next one offers it.
 */
export function repeatHintInBackground(
  ...args: Parameters<typeof repeatHintForRun>
): () => string | undefined {
  let hint: string | undefined;
  void repeatHintForRun(...args).then((value) => {
    hint = value;
  });
  return () => hint;
}
