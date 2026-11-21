import { describe, expect, it, vi } from "vitest";
import { shortenToolResultText } from "./context-selection.js";
import { TOOL_RESULT_TEXT_LIMIT } from "./pi-runtime-limits.js";
import {
  keepWholeResult,
  splitResultHandleNote,
  truncateWithHandle,
} from "./tool-result-overflow.js";

const big = (n: number) => `${"a".repeat(n - 6)}-END--`;

describe("keepWholeResult", () => {
  it("returns head, tail, the handle and a hint when a result overflows", async () => {
    const text = `HEAD-${"x".repeat(50_000)}-TAIL`;
    const store = vi.fn(async () => "h-1");
    const out = await keepWholeResult(
      { storeToolResult: store },
      { name: "shell", executionId: "call-1", text },
    );
    expect(store).toHaveBeenCalledWith({ name: "shell", executionId: "call-1", text });
    expect(out!.length).toBeLessThanOrEqual(TOOL_RESULT_TEXT_LIMIT);
    expect(out).toContain("HEAD-");
    expect(out).toContain("-TAIL");
    expect(out).toContain("handle h-1");
    expect(out).toContain("50,010 chars total");
    expect(out).toContain("read_result");
    expect(out).toContain("narrow the original request");
  });

  it("stores nothing for a result that fits, for read_result itself, or without a store", async () => {
    const store = vi.fn(async () => "h");
    expect(
      await keepWholeResult(
        { storeToolResult: store },
        { name: "shell", executionId: "c", text: big(TOOL_RESULT_TEXT_LIMIT) },
      ),
    ).toBeUndefined();
    expect(
      await keepWholeResult(
        { storeToolResult: store },
        { name: "read_result", executionId: "c", text: big(20_000) },
      ),
    ).toBeUndefined();
    expect(
      await keepWholeResult({}, { name: "shell", executionId: "c", text: big(20_000) }),
    ).toBeUndefined();
    expect(store).not.toHaveBeenCalled();
  });

  it("falls back to clipping when the store refuses or fails", async () => {
    const text = big(20_000);
    for (const storeToolResult of [
      async () => undefined,
      async () => {
        throw new Error("down");
      },
    ]) {
      expect(
        await keepWholeResult({ storeToolResult }, { name: "shell", executionId: "c", text }),
      ).toBeUndefined();
    }
  });
});

describe("handle note survives shortening", () => {
  it("keeps the handle when an older result is shortened", () => {
    const kept = truncateWithHandle(`HEAD${"y".repeat(40_000)}TAIL`, "h-keep");
    const shortened = shortenToolResultText(kept, 1024, { name: "shell" }, { afterUse: true });
    expect(shortened.length).toBeLessThan(kept.length / 4);
    expect(shortened).toContain("handle h-keep");
    expect(shortened).toContain("HEAD");
    expect(splitResultHandleNote(shortened)?.note).toContain("h-keep");
    // Shortening again changes nothing about the pointer.
    expect(shortenToolResultText(shortened, 512, {}, { afterUse: true })).toContain(
      "handle h-keep",
    );
  });
});
