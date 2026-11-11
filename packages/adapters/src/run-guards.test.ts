import { TURN_GUARD_RUN_ERRORS } from "@corvo/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approvalPausedToolResult } from "./approval-effect.js";
import {
  createRunGuards,
  guardedToolCall,
  type RunGuards,
  TurnGuardStopError,
  withGuardNote,
} from "./run-guards.js";
import { scheduleRoutineRetry } from "./run-routines.js";
import { IDLE_SLEEP_REFUSAL, REPEAT_NOTE } from "./turn-guard-calls.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe("run guards", () => {
  let guards: RunGuards;
  const abort = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    abort.mockReset();
    guards = createRunGuards({ abort, now: () => Date.now() });
  });
  afterEach(() => {
    guards.dispose();
    vi.useRealTimers();
  });

  const call = (
    name: string,
    args: Record<string, unknown>,
    run: () => Promise<unknown>,
    options: { readOnly?: boolean; signal?: AbortSignal } = {},
  ) =>
    guardedToolCall(
      {
        guards,
        signal: options.signal ?? new AbortController().signal,
        readOnlyConnectorTool: () => options.readOnly ?? false,
      },
      name,
      args,
      undefined,
      run,
    );

  describe("stall", () => {
    it("halts after twenty silent minutes and aborts once", async () => {
      await vi.advanceTimersByTimeAsync(1_200_000);
      expect(abort).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(abort).toHaveBeenCalledTimes(1);
      expect(guards.stopped).toBe("stall");
      await expect(guards.stop).rejects.toMatchObject({
        name: "TurnGuardStopError",
        kind: "stall",
        message: TURN_GUARD_RUN_ERRORS.stall,
      });
    });

    it("never halts while there are signs of life", async () => {
      for (let i = 0; i < 120; i++) {
        guards.sign();
        await vi.advanceTimersByTimeAsync(MINUTE);
      }
      expect(guards.stopped).toBeUndefined();
    });

    it("acts once and stops watching after dispose", async () => {
      const onHalt = vi.fn();
      const other = createRunGuards({ abort, onHalt });
      other.halt("loop");
      other.halt("stall");
      expect(other.stopped).toBe("loop");
      expect(abort).toHaveBeenCalledTimes(1);
      expect(onHalt).toHaveBeenCalledTimes(1);
      guards.dispose();
      await vi.advanceTimersByTimeAsync(3 * HOUR);
      expect(abort).toHaveBeenCalledTimes(1);
    });

    it("does not halt while a tool never resolves", async () => {
      void call("search", {}, () => new Promise(() => undefined));
      await vi.advanceTimersByTimeAsync(3 * HOUR);
      expect(guards.stopped).toBeUndefined();
    });

    it("holds a background shell command in flight until it settles", async () => {
      let finish: (value: { stdout: string; stderr: string; code: number }) => void = () =>
        undefined;
      const background = new Promise<{ stdout: string; stderr: string; code: number }>(
        (resolve) => {
          finish = resolve;
        },
      );
      await guardedToolCall(
        { guards, signal: new AbortController().signal, readOnlyConnectorTool: () => false },
        "shell",
        { command: "make" },
        undefined,
        async (observer) => {
          observer?.onShellStillRunning?.(background);
          return { stdout: "started" };
        },
      );
      await vi.advanceTimersByTimeAsync(3 * HOUR);
      expect(guards.stopped).toBeUndefined();
      finish({ stdout: "", stderr: "", code: 0 });
      await vi.advanceTimersByTimeAsync(20 * MINUTE + 15_000);
      expect(guards.stopped).toBe("stall");
    });
  });

  describe("guardedToolCall", () => {
    it("notes the third identical result and stops on the fifth", async () => {
      const run = vi.fn(async () => ({ stdout: "same" }));
      const results: unknown[] = [];
      for (let i = 0; i < 5; i++) results.push(await call("shell", { command: "ls" }, run));
      expect((results[2] as { guard_note?: string }).guard_note).toBe(REPEAT_NOTE);
      expect(guards.stopped).toBe("loop");
      expect(run).toHaveBeenCalledTimes(5);
    });

    it("does not stop a poll whose result keeps changing", async () => {
      let n = 0;
      for (let i = 0; i < 50; i++) {
        await call("shell", { command: "ls" }, async () => ({ stdout: String(n++) }));
      }
      expect(guards.stopped).toBeUndefined();
    });

    it("does not count a non-zero exit as a failure but counts error results", async () => {
      for (let i = 0; i < 8; i++) {
        await call("shell", { command: `c${i}` }, async () => ({ stdout: "", code: 1 }));
      }
      expect(guards.stopped).toBeUndefined();
      for (let i = 0; i < 8; i++) {
        await call("t", { i }, async () => ({ error: `x${i}` }));
      }
      expect(guards.stopped).toBe("tool_errors");
    });

    it("rethrows and counts a thrown error, but not after an abort", async () => {
      const error = new Error("boom");
      await expect(
        call("t", {}, async () => {
          throw error;
        }),
      ).rejects.toBe(error);
      expect(guards.calls.failing).toBe(1);

      const controller = new AbortController();
      controller.abort();
      await expect(
        call(
          "t",
          { again: true },
          async () => {
            throw error;
          },
          { signal: controller.signal },
        ),
      ).rejects.toBe(error);
      expect(guards.calls.failing).toBe(1);
    });

    it("returns a pause result untouched and does not count it", async () => {
      const paused = approvalPausedToolResult();
      expect(await call("send", {}, async () => paused)).toBe(paused);
      expect(guards.calls.repeats.size).toBe(0);
    });

    it("lets the first idle sleep run and refuses the rest, then stops", async () => {
      const run = vi.fn(async () => ({ stdout: "" }));
      const results: unknown[] = [];
      for (let i = 0; i < 5; i++) results.push(await call("shell", { command: "sleep 60" }, run));
      expect(run).toHaveBeenCalledTimes(1);
      for (const result of results.slice(1)) expect(result).toEqual({ error: IDLE_SLEEP_REFUSAL });
      expect(guards.stopped).toBe("waiting");
    });

    it("does not read sleeps for other tools", async () => {
      const run = vi.fn(async () => ({ ok: true }));
      for (let i = 0; i < 5; i++) await call("write_file", { command: "sleep 60" }, run);
      expect(run).toHaveBeenCalledTimes(5);
    });

    it("counts read-only connector tools and refuses past the limit", async () => {
      const run = vi.fn(async () => ({}));
      for (let i = 0; i < 64; i++) await call("search", { page: i }, run, { readOnly: true });
      expect(run).toHaveBeenCalledTimes(60);
      expect(guards.stopped).toBe("loop");
    });

    it("never counts tools that are not read-only connector tools", async () => {
      const run = vi.fn(async () => ({ n: Math.random() }));
      for (let i = 0; i < 64; i++) await call("search", { page: i }, run);
      expect(run).toHaveBeenCalledTimes(64);
      expect(guards.stopped).toBeUndefined();
    });
  });

  describe("withGuardNote", () => {
    it("appends a text part to an agent tool result", () => {
      const result = {
        kind: "agent_tool_result",
        content: [{ type: "text", text: "hi" }],
        details: { a: 1 },
      };
      expect(withGuardNote(result, "careful")).toEqual({
        ...result,
        content: [...result.content, { type: "text", text: "careful" }],
      });
    });

    it("adds a member to a plain object and wraps anything else", () => {
      expect(withGuardNote({ a: 1 }, "n")).toEqual({ a: 1, guard_note: "n" });
      expect(withGuardNote("text", "n")).toEqual({ result: "text", guard_note: "n" });
    });
  });

  it("is never retried automatically for a routine", async () => {
    await expect(
      scheduleRoutineRetry(
        {} as never,
        { id: "r1", threadId: "t1", trigger: "routine", routineId: "rt1", retryOfRunId: null },
        new TurnGuardStopError("stall"),
      ),
    ).resolves.toBe(false);
  });
});
