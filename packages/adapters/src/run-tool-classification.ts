import type { ConnectorTool, ToolClassifierProvider } from "@corvo/adapter-kit";
import type { ToolClassification } from "@corvo/core";
import { TOOL_CLASSIFIER_RUBRIC_VERSION } from "@corvo/core";
import { findToolClassifications, saveToolClassifications, toolClassificationKey } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import { resolveAutoReviewChecker } from "./auto-review.js";
import { checkerLlmOptions, resolveCheckerAccess } from "./run-auto-review.js";
import type { RunContext } from "./run-context.js";
import { LlmToolClassifier, toolDescriptionHash } from "./tool-classifier.js";

/** The classifier this run uses: the injected one, or the approval model connection. */
async function runToolClassifier(ctx: RunContext): Promise<ToolClassifierProvider | null> {
  if (ctx.deps.toolClassifier) return ctx.deps.toolClassifier;
  const settings = await ctx.trust.loadApprovalModel();
  const checker = settings.primary
    ? {
        provider: settings.primary.provider,
        model: settings.primary.modelId,
        thinkingLevel: settings.primary.thinkingLevel,
        credentialId: settings.primary.credentialId,
      }
    : resolveAutoReviewChecker();
  if (!checker) return null;
  const scope = {
    runId: ctx.runId,
    spaceId: ctx.run.spaceId,
    userId: ctx.run.userId,
    botId: ctx.bot.id,
    threadId: ctx.thread.id,
  };
  // Its usage is recorded under `tool-classifier:<run>`, apart from the run's answers.
  const access = await resolveCheckerAccess(
    ctx.deps,
    scope,
    {
      memberChecker: settings.primarySource === "member",
      backups: settings.backups,
      registerSecrets: (values) => ctx.secrets.push(...values),
      operation: "tool-classifier",
    },
    checker,
  );
  return new LlmToolClassifier(checkerLlmOptions(ctx.deps, scope, access, checker));
}

async function suggestionsFor(
  ctx: RunContext,
  connection: string,
  tools: readonly ConnectorTool[],
): Promise<Map<string, ToolClassification>> {
  const suggestions = new Map<string, ToolClassification>();
  const keyed = tools.map((tool) => ({
    tool,
    toolName: tool.name,
    descriptionHash: toolDescriptionHash(tool.description),
  }));
  const scope = {
    spaceId: ctx.run.spaceId,
    connection,
    rubricVersion: TOOL_CLASSIFIER_RUBRIC_VERSION,
  };
  const kept = await findToolClassifications(ctx.deps.prisma, { ...scope, tools: keyed });
  const missing = [];
  for (const entry of keyed) {
    const row = kept.get(toolClassificationKey(entry.toolName, entry.descriptionHash));
    if (!row) {
      missing.push(entry);
      continue;
    }
    if (row.risk === "read" || row.risk === "low" || row.risk === "high") {
      suggestions.set(entry.toolName, { risk: row.risk, confidence: row.confidence });
    }
  }
  if (missing.length === 0) return suggestions;
  try {
    const classifier = await runToolClassifier(ctx);
    if (!classifier) return suggestions;
    const answer = await classifier.classify(
      {
        connection,
        tools: missing.map((entry) => ({
          name: entry.toolName,
          description: entry.tool.description,
        })),
      },
      ctx.context,
    );
    const byName = new Map(missing.map((entry) => [entry.toolName, entry]));
    const rows = [];
    for (const suggestion of answer.suggestions) {
      const entry = byName.get(suggestion.name);
      if (!entry) continue;
      rows.push({
        toolName: entry.toolName,
        descriptionHash: entry.descriptionHash,
        risk: suggestion.risk,
        confidence: suggestion.confidence,
        model: answer.model,
      });
      if (suggestion.risk !== "unknown") {
        suggestions.set(entry.toolName, {
          risk: suggestion.risk,
          confidence: suggestion.confidence,
        });
      }
    }
    await saveToolClassifications(ctx.deps.prisma, { ...scope, rows }).catch((error) =>
      getLogger().error("tool classification cache", error),
    );
  } catch (error) {
    // A failure, timeout or cancelled run suggests nothing: those tools stay unknown and ask.
    // Nothing is cached, so a later run tries again.
    if (!ctx.context.signal.aborted)
      getLogger().warn("tool classifier failed", {
        error: error instanceof Error ? error.message : String(error),
      });
  }
  return suggestions;
}

/**
 * A model's suggestions for the unknown tools of one connection, when the owner opted in. One
 * batch per connection per run: tools it answered before, under the same description, come from
 * the cache. It only ever suggests; applyToolClassification decides what a suggestion may change.
 */
export async function classifyUnknownTools(
  ctx: RunContext,
  connection: string,
  tools: readonly ConnectorTool[],
): Promise<Map<string, ToolClassification>> {
  if (tools.length === 0) return new Map();
  if (!(await ctx.trust.loadAutoReviewPreference()).classifyTools) return new Map();
  const memo = ctx.state.toolClassification;
  const key = `${connection}\u0000${tools.map((tool) => tool.name).join("\u0000")}`;
  let pending = memo.get(key);
  if (!pending) {
    pending = suggestionsFor(ctx, connection, tools);
    memo.set(key, pending);
  }
  return pending;
}
