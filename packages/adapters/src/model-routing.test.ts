import { ModelOutputError } from "@corvo/adapter-kit";
import { describe, expect, it } from "vitest";
import {
  clampEscalationReason,
  decideTier,
  escalationTarget,
  escalationTriggerOf,
  nextTier,
  parseTierAnswer,
  routesAutomatically,
  TIER_CLASSIFIER_INSTRUCTIONS,
  TIER_RUBRIC_EXAMPLES,
  TIER_RUBRIC_VERSION,
  TIER_THINKING_LEVEL,
  type TurnSignals,
  tierClassifierPrompt,
} from "./model-routing.js";
import { TurnGuardStopError } from "./run-guards.js";

const turn = (overrides: Partial<TurnSignals>): TurnSignals => ({
  title: "",
  description: "",
  trigger: "user",
  prompt: "hello",
  contextTokens: 500,
  attachments: 0,
  approvalGated: false,
  ...overrides,
});

describe("decideTier", () => {
  it("settles only from structure, never from what the title or prompt says", () => {
    for (const title of ["Inbox triage", "Developer and research analyst", "Helper"]) {
      expect(
        decideTier(
          turn({ title, prompt: "Fix src/server.ts, then sort the inbox.\n```py\nx\n```" }),
        ),
      ).toEqual({ tier: "main", clear: false, reason: "ambiguous" });
    }
  });

  it("starts every autonomous trigger on the fast tier, whatever the title or prompt says", () => {
    for (const trigger of ["routine", "webhook", "cloud_agent", "tickets"] as const) {
      expect(
        decideTier(
          turn({
            title: "Developer and research analyst",
            trigger,
            prompt: "Check src/server.ts and the deploy status.",
            contextTokens: 150_000,
          }),
        ),
      ).toEqual({ tier: "fast", clear: true, reason: "background" });
    }
  });

  it("lets a background run escalate: the floor and approvals still win", () => {
    expect(decideTier(turn({ trigger: "routine", floor: "strong" }))).toMatchObject({
      tier: "strong",
      reason: "floor",
    });
    expect(decideTier(turn({ trigger: "routine", approvalGated: true }))).toMatchObject({
      tier: "main",
      reason: "approval",
    });
  });

  it("sends a very large context to the strong tier", () => {
    expect(decideTier(turn({ contextTokens: 150_000 }))).toMatchObject({
      tier: "strong",
      reason: "large-context",
    });
  });

  it("never gives an approval-gated action to the fast tier", () => {
    expect(decideTier(turn({ approvalGated: true, trigger: "resume" }))).toEqual({
      tier: "main",
      clear: true,
      reason: "approval",
    });
  });

  it("keeps a turn with attachments on the main tier without asking the classifier", () => {
    expect(decideTier(turn({ attachments: 1 }))).toEqual({
      tier: "main",
      clear: true,
      reason: "attachments",
    });
  });

  it("leaves an ordinary turn to the classifier on the main tier", () => {
    expect(decideTier(turn({ title: "Helper" }))).toEqual({
      tier: "main",
      clear: false,
      reason: "ambiguous",
    });
  });

  it("never goes below the floor an escalated run starts on", () => {
    expect(decideTier(turn({ trigger: "routine", floor: "main" }))).toMatchObject({
      tier: "main",
      reason: "floor",
    });
    expect(decideTier(turn({ floor: "strong" }))).toMatchObject({ tier: "strong", clear: true });
  });
});

describe("classifier rubric", () => {
  it("is versioned and shows a reviewed example of every tier", () => {
    expect(TIER_CLASSIFIER_INSTRUCTIONS).toContain(TIER_RUBRIC_VERSION);
    for (const tier of ["fast", "main", "strong"] as const) {
      expect(TIER_RUBRIC_EXAMPLES.some((example) => example.tier === tier)).toBe(true);
    }
    for (const example of TIER_RUBRIC_EXAMPLES) {
      expect(TIER_CLASSIFIER_INSTRUCTIONS).toContain(example.request);
    }
  });

  it("reads the role and a bounded excerpt of the request", () => {
    const prompt = tierClassifierPrompt(
      { title: "Inbox triage", description: "Sorts email" },
      "x".repeat(10_000),
    );
    expect(prompt.startsWith("Role: Inbox triage: Sorts email\nRequest: ")).toBe(true);
    expect(prompt.length).toBeLessThan(2_000);
    expect(tierClassifierPrompt({ title: "", description: "" }, "hi")).toBe(
      "Role: Assistant\nRequest: hi",
    );
  });
});

describe("thinking by tier", () => {
  it("thinks a little on fast, the default on main, and a lot only on strong", () => {
    expect(TIER_THINKING_LEVEL).toEqual({ fast: "low", main: "medium", strong: "high" });
  });
});

describe("parseTierAnswer", () => {
  it("accepts exactly one tier word", () => {
    expect(parseTierAnswer(" Strong. ")).toBe("strong");
    expect(parseTierAnswer("fast")).toBe("fast");
    expect(parseTierAnswer("main")).toBe("main");
  });

  it("rejects anything else so the turn stays on the main tier", () => {
    expect(parseTierAnswer("I think strong")).toBeNull();
    expect(parseTierAnswer("")).toBeNull();
    expect(parseTierAnswer(undefined)).toBeNull();
  });
});

describe("escalation", () => {
  it("moves up one tier at a time and stops at the strongest", () => {
    expect(nextTier("fast")).toBe("main");
    expect(nextTier("main")).toBe("strong");
    expect(nextTier("strong")).toBeNull();
  });

  it("escalates a cheaper tier once for a loop, failing tool calls or unusable output", () => {
    const loop = new TurnGuardStopError("loop");
    const toolErrors = new TurnGuardStopError("tool_errors");
    expect(escalationTarget({ tier: "fast", escalations: 0, error: loop })).toBe("main");
    expect(escalationTarget({ tier: "main", escalations: 0, error: toolErrors })).toBe("strong");
    expect(
      escalationTarget({ tier: "fast", escalations: 0, error: new ModelOutputError("empty") }),
    ).toBe("main");
  });

  it("never escalates twice, from the strongest tier, or for a failure a stronger model cannot fix", () => {
    const loop = new TurnGuardStopError("loop");
    expect(escalationTarget({ tier: "main", escalations: 1, error: loop })).toBeNull();
    expect(escalationTarget({ tier: "strong", escalations: 0, error: loop })).toBeNull();
    expect(
      escalationTarget({ tier: "fast", escalations: 0, error: new TurnGuardStopError("stall") }),
    ).toBeNull();
    expect(escalationTarget({ tier: "fast", escalations: 0, error: new Error("rate") })).toBeNull();
  });

  it("does not escalate a run that was not routed", () => {
    expect(
      escalationTarget({ tier: null, escalations: 0, error: new TurnGuardStopError("loop") }),
    ).toBeNull();
  });

  it("escalates when the agent asks for a stronger model", () => {
    expect(
      escalationTarget({
        tier: "fast",
        escalations: 0,
        error: new Error("asked"),
        requested: true,
      }),
    ).toBe("main");
  });
});

describe("escalationTriggerOf", () => {
  it("names what made the run move up", () => {
    expect(escalationTriggerOf(new TurnGuardStopError("loop"), false)).toBe("loop");
    expect(escalationTriggerOf(new TurnGuardStopError("tool_errors"), false)).toBe("tool_errors");
    expect(escalationTriggerOf(new ModelOutputError("empty"), false)).toBe("model_output");
    expect(escalationTriggerOf(new Error("aborted"), true)).toBe("agent_request");
  });
});

describe("clampEscalationReason", () => {
  it("keeps one short line, whatever the agent sends", () => {
    expect(clampEscalationReason("  needs\n a   proof ")).toBe("needs a proof");
    expect(clampEscalationReason("x".repeat(500))).toHaveLength(200);
    expect(clampEscalationReason(undefined)).toBe("");
  });
});

describe("routesAutomatically", () => {
  it("routes only an automatic agent without a pinned model", () => {
    expect(routesAutomatically({ modelAuto: true, pinned: false, hasModel: false })).toBe(true);
    expect(routesAutomatically({ modelAuto: false, pinned: false, hasModel: false })).toBe(false);
  });

  it("leaves a pinned model exactly as it is", () => {
    expect(routesAutomatically({ modelAuto: true, pinned: true, hasModel: false })).toBe(false);
    expect(routesAutomatically({ modelAuto: true, pinned: false, hasModel: true })).toBe(false);
  });
});
