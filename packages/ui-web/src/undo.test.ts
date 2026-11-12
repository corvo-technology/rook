import { beforeEach, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock("./components/ui/sonner.js", () => ({ toast }));

import { undoable, undoableDeferred } from "./undo.js";

beforeEach(() => {
  toast.mockClear();
  toast.error.mockClear();
});

type Action = { label: string; onClick: () => void };
const action = () => ((toast.mock.calls as unknown[][])[0]![1] as { action: Action }).action;

it("runs first, then offers Undo that reverses with the result", async () => {
  const undo = vi.fn();
  const result = await undoable({
    message: "Removed",
    undoLabel: "Undo",
    undoneMessage: "Undone",
    run: () => "rule-1",
    undo,
  });
  expect(result).toBe("rule-1");
  expect(toast.mock.calls[0]?.[0]).toBe("Removed");
  action().onClick();
  await vi.waitFor(() => expect(toast).toHaveBeenCalledWith("Undone"));
  expect(undo).toHaveBeenCalledWith("rule-1");
});

it("shows nothing when the action fails, and reports a failed undo", async () => {
  await expect(
    undoable({
      message: "x",
      undoLabel: "Undo",
      run: () => Promise.reject(new Error("no")),
      undo: vi.fn(),
    }),
  ).rejects.toThrow("no");
  expect(toast).not.toHaveBeenCalled();
  await undoable({
    message: "x",
    undoLabel: "Undo",
    undoFailedMessage: "Could not undo",
    run: () => 1,
    undo: () => Promise.reject(new Error("no")),
  });
  action().onClick();
  await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not undo"));
});

it("commits after the toast expires unless Undo is pressed", async () => {
  vi.useFakeTimers();
  const commit = vi.fn();
  const first = undoableDeferred({
    message: "Deleted",
    undoLabel: "Undo",
    commit,
    durationMs: 100,
  });
  vi.advanceTimersByTime(101);
  await expect(first).resolves.toBe("committed");
  expect(commit).toHaveBeenCalledTimes(1);

  toast.mockClear();
  const onUndo = vi.fn();
  const second = undoableDeferred({
    message: "Deleted",
    undoLabel: "Undo",
    commit,
    onUndo,
    durationMs: 100,
  });
  action().onClick();
  vi.advanceTimersByTime(200);
  await expect(second).resolves.toBe("undone");
  expect(commit).toHaveBeenCalledTimes(1);
  expect(onUndo).toHaveBeenCalled();
  vi.useRealTimers();
});
