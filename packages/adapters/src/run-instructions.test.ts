import { describe, expect, it } from "vitest";
import {
  LIVE_CONTEXT_GUIDANCE,
  LIVE_CONTEXT_HEADER,
  liveContextBlock,
  turnNote,
  turnNoteApplies,
  userTurnInstructions,
} from "./run-instructions.js";

const setup = {
  botInstructions: "Be helpful.",
  computerInstruction: "You have a computer.",
  pageBrowserAllowed: true,
  workspaceInstruction: "Workspace.",
  agentEnvironmentInstruction: undefined,
  replyGuidance: "Reply.",
  hasHistoricalContext: false,
};
const system = (parts: Parameters<typeof userTurnInstructions>[0]) =>
  userTurnInstructions(parts).filter(Boolean).join("\n\n");

const live = {
  groupContext: "group",
  messagingContext: "messaging",
  redactedMemoryContext: "memory",
  redactedScratchpadContext: "scratchpad",
  teamDirectory: "team",
  pluginLine: "plugins",
  agentSkillsLine: "skills",
  taughtSkillsLine: "taught",
};

describe("stable system prompt", () => {
  it("ignores every live part", () => {
    const first = system({ ...setup, ...live });
    const second = system({
      ...setup,
      groupContext: "g2",
      messagingContext: "m2",
      redactedMemoryContext: "mem2",
      redactedScratchpadContext: "s2",
      teamDirectory: "t2",
      pluginLine: "p2",
      agentSkillsLine: "a2",
      taughtSkillsLine: "ts2",
    });
    expect(first).toBe(second);
    expect(first).toBe(system(setup));
    expect(first).toContain(LIVE_CONTEXT_GUIDANCE);
  });

  it("changes with the setup", () => {
    const base = system(setup);
    expect(system({ ...setup, botInstructions: "Other." })).not.toBe(base);
    expect(system({ ...setup, disabledBuiltinTools: new Set(["remember"]) })).not.toBe(base);
  });
});

describe("liveContextBlock", () => {
  it("renders sections in a fixed order", () => {
    expect(liveContextBlock(live)).toBe(
      `${LIVE_CONTEXT_HEADER}\n${[
        "group",
        "messaging",
        "memory",
        "scratchpad",
        "team",
        "plugins",
        "skills",
        "taught",
      ].join("\n\n")}`,
    );
    expect(liveContextBlock({})).toBe("");
  });
});

describe("turnNote", () => {
  it("joins the non-empty parts in order", () => {
    const parts = {
      replyContext: "1",
      attachedFilesPrompt: "2",
      missingImagesInstruction: "3",
      takeoverNote: "4",
      approvalContinuation: "5",
      voiceInstruction: "6",
      currentTime: "7",
      lateRoutineNote: "8",
      routingHint: "9",
      repeatHint: "10",
      redactedTicketContext: "11",
      redactedRecalledMemory: "12",
    };
    expect(turnNote(parts)).toBe(Object.values(parts).join("\n\n"));
    expect(turnNote({ currentTime: "now" })).toBe("now");
  });
});

describe("turnNoteApplies", () => {
  const ok = {
    sourceMessageId: "m1",
    trigger: "user",
    invokedSkill: false,
    promptExpanded: false,
    hasCurrentTurnImages: false,
  };
  it("is true for a plain source message", () => {
    expect(turnNoteApplies(ok)).toBe(true);
  });
  it.each([
    { trigger: "reaction" },
    { invokedSkill: true },
    { promptExpanded: true },
    { hasCurrentTurnImages: true },
    { sourceMessageId: null },
  ])("is false for %o", (override) => {
    expect(turnNoteApplies({ ...ok, ...override })).toBe(false);
  });
});
