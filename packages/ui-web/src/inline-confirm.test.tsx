// @vitest-environment jsdom
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { InlineConfirm } from "./inline-confirm.js";
import { key, mount } from "./test-render.js";

afterEach(() => vi.useRealTimers());

async function setup(onConfirm = vi.fn()) {
  const view = await mount(
    <InlineConfirm confirmLabel="Confirm delete?" onConfirm={onConfirm} timeoutMs={1000}>
      Delete
    </InlineConfirm>,
  );
  const button = view.host.querySelector("button")!;
  return { view, button, onConfirm };
}

it("needs two clicks and announces the question", async () => {
  const { view, button, onConfirm } = await setup();
  await act(async () => button.click());
  expect(onConfirm).not.toHaveBeenCalled();
  expect(button.textContent).toBe("Confirm delete?");
  expect(view.host.querySelector("[role=status]")?.textContent).toBe("Confirm delete?");
  await act(async () => button.click());
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(button.textContent).toBe("Delete");
  await view.cleanup();
});

it("disarms on Esc, on blur and after the timeout", async () => {
  vi.useFakeTimers();
  const { view, button, onConfirm } = await setup();
  await act(async () => button.click());
  await key(document, "Escape");
  expect(button.textContent).toBe("Delete");
  await act(async () => button.click());
  await act(async () => button.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  expect(button.textContent).toBe("Delete");
  await act(async () => button.click());
  await act(async () => vi.advanceTimersByTime(1001));
  expect(button.textContent).toBe("Delete");
  expect(onConfirm).not.toHaveBeenCalled();
  await view.cleanup();
});
