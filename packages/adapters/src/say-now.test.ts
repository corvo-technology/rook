import { describe, expect, it, vi } from "vitest";
import type { RunContext } from "./run-context.js";
import { publishMessage } from "./run-messages.js";
import type { ToolCall } from "./run-tool-gate.js";
import { selectBuiltinToolsForRun } from "./run-tool-selection.js";
import { messagingTools } from "./run-tools-messaging.js";
import {
  isSayNowClientNonce,
  SAY_NOW_MAX_LENGTH,
  sayNowAllowed,
  sayNowClientNonce,
  withoutSayNowRepeat,
} from "./user-progress.js";

vi.mock("./run-messages.js", () => ({ publishMessage: vi.fn(async () => undefined) }));
vi.mock("./run-progress.js", () => ({
  flushProgress: vi.fn(async () => undefined),
  publishMidTurnNarration: vi.fn(async () => undefined),
  canPublishDurableProgress: vi.fn(() => false),
}));

const baseSelection = {
  graphicalToolsAllowed: false,
  groupId: null,
  semanticMemoryEnabled: false,
  messagingChannelRun: false,
} as const;

function offered(options: Partial<Parameters<typeof selectBuiltinToolsForRun>[0]>) {
  return selectBuiltinToolsForRun({ ...baseSelection, trigger: "user", ...options }).some(
    (tool) => tool.name === "say_now",
  );
}

function context(overrides: Partial<RunContext["source"]> = {}, secrets: string[] = []) {
  return {
    deps: {},
    run: { id: "run-1", trigger: "user" },
    secrets,
    source: {
      ownerStartedRun: true,
      messagingChannelRun: false,
      voiceCall: false,
      ...overrides,
    },
    state: { reply: { sayNowText: undefined, midTurnUserTexts: [] } },
  } as unknown as RunContext;
}

function call(message: unknown, executionId = "exec-1") {
  return {
    args: { message },
    executionId,
    finish: async (result: unknown) => result,
  } as unknown as ToolCall;
}

const sayNow = (ctx: RunContext, c: ToolCall) => messagingTools.say_now?.(ctx, c);

describe("say_now offering", () => {
  it("is offered only when the gate allows it", () => {
    expect(offered({})).toBe(false);
    expect(offered({ sayNowOffered: true })).toBe(true);
  });

  it("is gated to live person-facing runs", () => {
    const live = {
      ownerStartedRun: true,
      messagingChannelRun: false,
      voiceCall: false,
      visitorRun: false,
    };
    expect(sayNowAllowed(live)).toBe(true);
    expect(sayNowAllowed({ ...live, ownerStartedRun: false })).toBe(false);
    expect(sayNowAllowed({ ...live, messagingChannelRun: true })).toBe(false);
    expect(sayNowAllowed({ ...live, voiceCall: true })).toBe(false);
    expect(sayNowAllowed({ ...live, visitorRun: true })).toBe(false);
  });

  it("is never offered in unattended runs even if the flag were set", () => {
    // Unattended triggers are not owner started, so the executor never sets the flag.
    for (const trigger of ["routine", "webhook", "tickets", "bot_message", "spawn", "messaging"]) {
      expect(
        sayNowAllowed({
          ownerStartedRun: trigger === "user",
          messagingChannelRun: false,
          voiceCall: false,
          visitorRun: false,
        }),
      ).toBe(false);
    }
  });
});

describe("say_now handler", () => {
  it("posts the line once as its own durable message", async () => {
    vi.mocked(publishMessage).mockClear();
    const ctx = context();
    expect(await sayNow(ctx, call("  I'll open the calendar and create the event.  "))).toEqual({
      ok: true,
    });
    expect(publishMessage).toHaveBeenCalledWith(
      ctx.deps,
      ctx.run,
      "bot",
      [{ kind: "text", text: "I'll open the calendar and create the event." }],
      true,
      sayNowClientNonce("run-1"),
    );
    expect(isSayNowClientNonce(sayNowClientNonce("run-1"))).toBe(true);
  });

  it("refuses a second call in the same run", async () => {
    vi.mocked(publishMessage).mockClear();
    const ctx = context();
    await sayNow(ctx, call("Starting now."));
    const second = (await sayNow(ctx, call("Again."))) as { error?: string };
    expect(second.error).toMatch(/already used/);
    expect(publishMessage).toHaveBeenCalledTimes(1);
  });

  it("refuses a line over the cap without posting a cut-off one", async () => {
    vi.mocked(publishMessage).mockClear();
    const ctx = context();
    const result = (await sayNow(ctx, call("x".repeat(SAY_NOW_MAX_LENGTH + 1)))) as {
      error?: string;
    };
    expect(result.error).toMatch(/shorter/);
    expect(publishMessage).not.toHaveBeenCalled();
    expect(await sayNow(ctx, call("x".repeat(SAY_NOW_MAX_LENGTH)))).toEqual({ ok: true });
  });

  it("masks secrets", async () => {
    vi.mocked(publishMessage).mockClear();
    await sayNow(context({}, ["hunter2-token"]), call("Logging in with hunter2-token now."));
    const blocks = vi.mocked(publishMessage).mock.calls[0]?.[3];
    expect(JSON.stringify(blocks)).not.toContain("hunter2-token");
  });

  it("is refused outside a live person-facing run and in subagents", async () => {
    vi.mocked(publishMessage).mockClear();
    for (const ctx of [
      context({ ownerStartedRun: false }),
      context({ messagingChannelRun: true }),
      context({ voiceCall: true }),
    ]) {
      expect(await sayNow(ctx, call("Starting."))).toEqual({
        error: "say_now is not available in this run.",
      });
    }
    const helperId = JSON.stringify(["pi-tool", "helper-1", "call-1"]);
    expect(await sayNow(context(), call("Starting.", helperId))).toEqual({
      error: "say_now is not available in this run.",
    });
    expect(publishMessage).not.toHaveBeenCalled();
  });

  it("requires a message", async () => {
    expect(await sayNow(context(), call("   "))).toEqual({ error: "message is required" });
  });
});

describe("withoutSayNowRepeat", () => {
  const line = "I'll open the calendar and create the event.";

  it("drops a final reply that only repeats the line", () => {
    expect(withoutSayNowRepeat(line, line)).toBe("");
    expect(withoutSayNowRepeat(`  ${line.toUpperCase()}`, line)).toBe("");
  });

  it("drops a repeated opening and keeps the rest", () => {
    expect(withoutSayNowRepeat(`${line} Done: it is on Friday at 3pm.`, line)).toBe(
      "Done: it is on Friday at 3pm.",
    );
  });

  it("leaves a different reply alone", () => {
    expect(withoutSayNowRepeat("Done: it is on Friday.", line)).toBe("Done: it is on Friday.");
  });
});
