import type { AdapterContext, MemorySnapshot, MemoryStore } from "@corvo/adapter-kit";
import { renderBotDirectory } from "@corvo/core";
import { describe, expect, it } from "vitest";
import { partitionTools } from "./builtin-tool-bridge.js";
import { estimateTextTokens } from "./context-selection.js";
import {
  capHistoryTokens,
  MAX_HISTORY_TOKENS,
  PROMPT_HISTORY_WINDOW_SIZE,
} from "./history-compaction.js";
import { loadAgentMemoryContext, MAX_AGENT_MEMORY_BYTES } from "./memory-context.js";
import {
  BOT_DIRECTORY_LIMIT,
  BOT_DIRECTORY_POOL,
  liveContextBlock,
  persistentComputerInstruction,
  pickRosterTeammates,
  runIdentityInstruction,
  userTurnInstructions,
} from "./run-instructions.js";
import { offeredFleetTools, selectBuiltinToolsForRun } from "./run-tool-selection.js";
import { formatWikiIndex, MAX_WIKI_INDEX_BYTES } from "./wiki-context.js";

/**
 * Builds the text of a run's first model call (system prompt, tool block, live context, earlier
 * conversation) for a fixture space of 20 agents, and holds it under a token budget. Offline and
 * deterministic: it counts with the product's own conservative estimator, so it guards against
 * growth rather than predicting a provider's invoice.
 */

const TEXT = "The quarterly report needs the refund numbers checked against the ledger. ";

function fixtureAgents(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `clx${String(index).padStart(3, "0")}abcdefghijklmnopqrstuvwxyz`.slice(0, 25),
    name: `Agent ${index + 1}`,
    title: `Specialist ${index + 1}`,
    description: TEXT.repeat(3).slice(0, 150),
  }));
}

const memoryStore: MemoryStore = {
  async read(scope: { scope: string }): Promise<MemorySnapshot> {
    const documents =
      scope.scope === "bot"
        ? Array.from({ length: 3 }, (_, index) => ({
            path: `notes/${index}.md`,
            content: TEXT.repeat(90),
            revision: 1,
            updatedAt: new Date(2026, 0, index + 1).toISOString(),
          }))
        : [];
    return { documents } as unknown as MemorySnapshot;
  },
} as unknown as MemoryStore;

function tokens(text: string) {
  return estimateTextTokens(text);
}

function toolTokens(fleetManagement: boolean) {
  const offered = selectBuiltinToolsForRun({
    graphicalToolsAllowed: true,
    groupId: null,
    trigger: "user",
    semanticMemoryEnabled: true,
    messagingChannelRun: false,
    historyRetrievalEnabled: true,
    ticketBoardEnabled: true,
    mediaImagesEnabled: true,
    fleetManagement,
  });
  const { listed } = partitionTools(offered);
  return {
    offered,
    tokens: tokens(
      JSON.stringify(
        listed.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        })),
      ),
    ),
  };
}

async function firstCall(options: { chief: boolean }) {
  const { offered, tokens: toolBlock } = toolTokens(options.chief);
  const system = userTurnInstructions({
    botInstructions: runIdentityInstruction(
      { name: "Ana", title: "Assistant", description: "", instructions: TEXT.repeat(16) },
      "user",
    ),
    hasHistoricalContext: false,
    historyRetrievalEnabled: true,
    computerInstruction: persistentComputerInstruction({
      heldForTakeover: false,
      graphicalToolsAllowed: true,
      graphical: true,
    }),
    pageBrowserAllowed: true,
    workspaceInstruction: "This entire computer workspace is your private home.",
    agentEnvironmentInstruction: undefined,
    replyGuidance: "",
    offeredFleetTools: offeredFleetTools(offered),
  })
    .filter(Boolean)
    .join("\n\n");

  const teammates = fixtureAgents(20);
  const { listed, omitted } = pickRosterTeammates(teammates.slice(0, BOT_DIRECTORY_POOL), {
    channelMemberIds: new Set(),
    lastActiveAt: new Map(),
  });
  const memory = await loadAgentMemoryContext(
    memoryStore,
    "bot-1",
    {} as AdapterContext,
    MAX_AGENT_MEMORY_BYTES,
  );
  const wiki = formatWikiIndex(
    Array.from({ length: 200 }, (_, index) => ({
      title: `Page ${index}`,
      kind: "note",
      summary: TEXT.slice(0, 60),
    })) as never,
    MAX_WIKI_INDEX_BYTES,
  );
  const live = liveContextBlock({
    redactedMemoryContext: memory,
    teamDirectory: renderBotDirectory(listed, { omitted }),
    pluginLine: wiki,
  });
  const history = capHistoryTokens(
    Array.from({ length: 150 }, (_, seq) => ({ seq, content: TEXT.repeat(2) })).slice(
      -PROMPT_HISTORY_WINDOW_SIZE,
    ),
    MAX_HISTORY_TOKENS,
  );
  const parts = {
    tools: toolBlock,
    system: tokens(system),
    live: tokens(live),
    history: history.reduce((total, message) => total + tokens(message.content) + 8, 0),
  };
  return { ...parts, total: parts.tools + parts.system + parts.live + parts.history };
}

// Before the caps, with the same fixture and estimator: tool block 11,763 tokens (Chief 11,828),
// memory 6,120 and wiki index 2,712 at the old limits, roster 1,419, history 7,950.
describe("the first model call stays within its token budget", () => {
  it("normal agent", async () => {
    const call = await firstCall({ chief: false });
    // Two names in the deferred tool index (research_start, research_status) cost about 10 tokens.
    expect(call.tools).toBeLessThan(8_050);
    expect(call.system).toBeLessThan(3_150);
    expect(call.total).toBeLessThan(22_000);
  });

  it("the Chief", async () => {
    const call = await firstCall({ chief: true });
    expect(call.tools).toBeLessThan(8_150);
    expect(call.total).toBeLessThan(23_000);
  });

  it("names at most the capped number of teammates", () => {
    const { listed, omitted } = pickRosterTeammates(fixtureAgents(40), {
      channelMemberIds: new Set(["clx039abcdefghijklmnopqrs"]),
      lastActiveAt: new Map([["clx020abcdefghijklmnopqrs", new Date()]]),
    });
    expect(listed).toHaveLength(BOT_DIRECTORY_LIMIT);
    expect(omitted).toBe(40 - BOT_DIRECTORY_LIMIT);
    expect(listed[0]?.name).toBe("Agent 40");
    expect(listed[1]?.name).toBe("Agent 21");
  });
});
