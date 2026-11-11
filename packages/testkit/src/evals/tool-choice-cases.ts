import type { ToolChoiceCase } from "./tool-choice.js";
import { toolChoiceEvalCase } from "./tool-choice.js";

/** Synthetic prompts only. Production-derived cases belong in a local --cases-file. */
const NO_SCREEN = ["computer_observe", "computer_act", "browser_navigate", "browser_act"];

export const TOOL_CHOICE_DEFINITIONS: ToolChoiceCase[] = [
  // Everyday work, with the tools a run always lists.
  {
    id: "remember-fact",
    area: "everyday",
    kind: "guard",
    purpose: "Save a durable fact when asked to remember it.",
    prompt: "Remember that my favorite color is green.",
    expect: { anyOf: [{ tool: "remember" }, { tool: "save_memory" }] },
  },
  {
    id: "remember-control",
    area: "everyday",
    kind: "control",
    purpose: "Answer a plain question without any tool.",
    prompt: "What is 12 times 12?",
    expect: { notCalls: ["*"] },
  },
  {
    id: "lookup-without-screen",
    area: "everyday",
    kind: "guard",
    purpose: "Look something up with search or fetch, not by driving a browser.",
    prompt: "Look up what the latest stable version of Node.js is.",
    expect: {
      anyOf: [{ tool: "web_search" }, { tool: "web_fetch" }],
      notCalls: NO_SCREEN,
    },
  },
  {
    id: "lookup-control",
    area: "everyday",
    kind: "control",
    purpose: "Answer a greeting without a screen or a search.",
    prompt: "Hi! How are you today?",
    expect: { notCalls: ["*"] },
  },
  // Built-ins the run does not list, reached through find_tool and use_tool.
  {
    id: "deferred-scratchpad",
    area: "deferred-tools",
    kind: "guard",
    purpose: "Reach a deferred tool through the bridge and run it.",
    prompt: "Add 'buy milk' to your scratchpad so you remember to finish it.",
    expect: { calls: [{ tool: "scratchpad_add" }] },
  },
  {
    id: "deferred-secret",
    area: "deferred-tools",
    kind: "guard",
    purpose: "Generate a password with the deferred tool instead of inventing one.",
    prompt: "I'm signing up for a service. Generate a strong password for it and keep it safe.",
    expect: { anyOf: [{ tool: "generate_secret" }] },
  },
  {
    id: "deferred-control",
    area: "deferred-tools",
    kind: "control",
    purpose: "Do ordinary work without searching for tools.",
    prompt: "In one sentence, what is a REST API?",
    expect: { notCalls: ["*"] },
  },
  // The Chief explains the app from its guide and diagnoses from the space status.
  {
    id: "guide-before-explaining",
    area: "chief-guide",
    kind: "guard",
    purpose: "Read the matching guide page before explaining how the app works.",
    bot: { fleetManagement: true },
    prompt: "How do approvals work here?",
    expect: { calls: [{ tool: "guide_read", args: { page: "approvals" } }] },
  },
  {
    id: "guide-language",
    area: "chief-guide",
    kind: "guard",
    purpose: "Pass the language the person writes in when reading a guide page.",
    bot: { fleetManagement: true },
    prompt: "Como funcionam as rotinas?",
    expect: { calls: [{ tool: "guide_read", args: { page: "routines", language: "pt-BR" } }] },
  },
  {
    id: "status-before-diagnosing",
    area: "chief-guide",
    kind: "guard",
    purpose: "Look at the space's status before saying why a routine did nothing.",
    bot: { fleetManagement: true },
    prompt: "Why did my morning routine not send anything?",
    expect: { anyOf: [{ tool: "space_status" }, { tool: "list_routines" }] },
  },
  {
    id: "guide-control",
    area: "chief-guide",
    kind: "control",
    purpose: "Answer plain arithmetic without reading the guide or the status.",
    bot: { fleetManagement: true },
    prompt: "What is 12 times 12?",
    expect: { notCalls: ["guide_read", "space_status"] },
  },
];

export const TOOL_CHOICE_CASES = TOOL_CHOICE_DEFINITIONS.map(toolChoiceEvalCase);
