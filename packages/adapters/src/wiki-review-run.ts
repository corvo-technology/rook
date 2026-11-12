import {
  buildWikiRetryPrompt,
  buildWikiReviewPrompt,
  parseWikiPage,
  parseWikiRetryOutput,
  parseWikiReviewOutput,
  wikiCanonicalTitle,
  wikiRetrySystemPrompt,
  wikiReviewSystemPrompt,
} from "@corvo/core";
import {
  createWikiChange,
  knownWikiFindingTitles,
  listWikiPages,
  markWikiReviewed,
  readWikiPage,
  reopenWikiChange,
  wikiChangeToRetry,
  wikiReviewDue,
} from "@corvo/db";
import { getLogger } from "@corvo/logging";
import { askWikiModel, type WikiCuratorDeps } from "./wiki-curator-run.js";

/** The newest pages read in one review, each cut to its start, so one call holds them all. */
const REVIEW_PAGES = 40;
const REVIEW_PAGE_CHARS = 2_000;
const RETRY_PAGE_CHARS = 6_000;
/** Two pages are the least that can contradict each other. */
const REVIEW_MIN_PAGES = 2;

type Scope = { spaceId: string; userId: string };
type ReviewDeps = Pick<WikiCuratorDeps, "prisma" | "runtime" | "resolveFastModel">;

const same = (a: string, b: string) =>
  wikiCanonicalTitle(a).toLowerCase() === wikiCanonicalTitle(b).toLowerCase();

/**
 * Reads the Space's pages together for contradictions, facts that went stale and duplicates, and
 * keeps each finding as a change that waits for a person to approve or refuse it. The weekly run
 * does nothing until a week has passed; a person's own request (`manual`) always runs. Nothing is
 * written without a model, and a model that fails is tried again by the queue.
 */
export async function reviewWiki(
  deps: ReviewDeps,
  payload: Scope & { manual?: boolean },
  now: Date = new Date(),
): Promise<void> {
  const { prisma } = deps;
  const scope = { spaceId: payload.spaceId, userId: payload.userId };
  if (!payload.manual && !(await wikiReviewDue(prisma, scope.spaceId, now))) return;
  const model = await deps.resolveFastModel?.(scope);
  if (!model || model.provider === "scripted") {
    getLogger().info(`wiki review skipped for space ${scope.spaceId}: no fast model is ready`);
    return;
  }

  const listed = (await listWikiPages(prisma, scope))
    .filter((page) => page.title !== "Wiki rules")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, REVIEW_PAGES);
  if (listed.length < REVIEW_MIN_PAGES) {
    await markWikiReviewed(prisma, scope.spaceId, now);
    return;
  }
  const pages = (
    await Promise.all(
      listed.map(async (info) => {
        const page = await readWikiPage(prisma, scope, info.title);
        return page
          ? {
              title: page.title,
              updatedAt: page.updatedAt.slice(0, 10),
              body: parseWikiPage(page.body).body.slice(0, REVIEW_PAGE_CHARS),
            }
          : undefined;
      }),
    )
  ).flatMap((page) => page ?? []);
  const known = await knownWikiFindingTitles(prisma, scope);

  const operationId = `wiki-review:${scope.spaceId}`;
  const { answer, failed } = await askWikiModel(deps, {
    model,
    scope,
    botId: "wiki-review",
    threadId: operationId,
    operationId,
    runId: `${operationId}:${now.getTime()}`,
    prompt: buildWikiReviewPrompt({ pages, known }),
    instructions: wikiReviewSystemPrompt(now.toISOString().slice(0, 10)),
  });
  const findings = failed ? null : parseWikiReviewOutput(answer);
  // Throwing leaves the week unmarked, so the queue tries the review again.
  if (!findings) throw new Error("The wiki review's model did not answer with usable findings.");

  const reported = [...known];
  for (const finding of findings) {
    if (reported.some((title) => same(title, finding.title))) continue;
    reported.push(finding.title);
    // A finding always waits for approval, whatever the Space says about edits.
    await createWikiChange(prisma, scope, {
      source: { origin: "review", title: finding.title, text: finding.reason },
      ops: finding.ops,
      reason: finding.reason,
      anchor: {},
      edits: "approve",
    });
  }
  await markWikiReviewed(prisma, scope.spaceId, now);
}

/**
 * Writes a change that could not be applied because a page moved on again, against the pages as
 * they are now, and puts it back to waiting. When nothing of it still applies, or the model has
 * nothing to say, the change stays as it was.
 */
export async function retryWikiChange(
  deps: ReviewDeps,
  payload: Scope & { changeId: string },
): Promise<void> {
  const { prisma } = deps;
  const scope = { spaceId: payload.spaceId, userId: payload.userId };
  const change = await wikiChangeToRetry(prisma, scope, payload.changeId);
  if (!change) return;
  const model = await deps.resolveFastModel?.(scope);
  if (!model || model.provider === "scripted") {
    getLogger().info(`wiki retry skipped for change ${payload.changeId}: no fast model is ready`);
    return;
  }
  const titles = [...new Set(change.ops.map((op) => wikiCanonicalTitle(op.page)))];
  const current = (
    await Promise.all(
      titles.map(async (title) => {
        const page = await readWikiPage(prisma, scope, title);
        return page
          ? { title: page.title, body: parseWikiPage(page.body).body.slice(0, RETRY_PAGE_CHARS) }
          : { title, body: "(no such page)" };
      }),
    )
  ).flat();

  const operationId = `wiki-retry:${payload.changeId}`;
  const { answer, failed } = await askWikiModel(deps, {
    model,
    scope,
    botId: "wiki-curator",
    threadId: operationId,
    operationId,
    runId: `${operationId}:${Date.now()}`,
    prompt: buildWikiRetryPrompt({ ops: change.ops, pages: current, source: change.sourceText }),
    instructions: wikiRetrySystemPrompt(),
  });
  const ops = failed ? null : parseWikiRetryOutput(answer);
  if (!ops) throw new Error("The wiki curator's model did not answer with usable changes.");
  if (ops.length) await reopenWikiChange(prisma, scope, payload.changeId, ops);
}
