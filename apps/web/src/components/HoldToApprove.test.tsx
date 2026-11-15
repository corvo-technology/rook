// @vitest-environment jsdom

import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HoldToApprove } from "./HoldToApprove";

let root: Root;
let container: HTMLDivElement;
const onApprove = vi.fn();

function matchMedia(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced && query.includes("prefers-reduced-motion"),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  matchMedia(false);
  onApprove.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function render(props: { busy?: string; disabled?: boolean } = {}) {
  await act(async () =>
    root.render(
      <HoldToApprove
        label="Hold to approve"
        confirmLabel="Allow once"
        onApprove={onApprove}
        {...props}
      />,
    ),
  );
  return container.querySelector("button")!;
}

const pointer = (type: string) =>
  new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 });
const key = (type: string, key: string, repeat = false) =>
  new KeyboardEvent(type, { bubbles: true, cancelable: true, key, repeat });

it("approves only once the press has been held for the whole time", async () => {
  const button = await render();
  await act(async () => button.dispatchEvent(pointer("pointerdown")));
  expect(button.dataset.holding).toBe("true");
  await act(async () => vi.advanceTimersByTime(799));
  expect(onApprove).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1));
  expect(onApprove).toHaveBeenCalledTimes(1);
  expect(button.dataset.holding).toBeUndefined();
});

it("lets go when the press ends early, and a quick tap approves nothing", async () => {
  const button = await render();
  await act(async () => button.dispatchEvent(pointer("pointerdown")));
  await act(async () => vi.advanceTimersByTime(400));
  await act(async () => button.dispatchEvent(pointer("pointerup")));
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  });
  await act(async () => vi.advanceTimersByTime(2000));
  expect(onApprove).not.toHaveBeenCalled();
  expect(button.dataset.holding).toBeUndefined();
});

it("lets go when the pointer leaves the button", async () => {
  const button = await render();
  await act(async () => button.dispatchEvent(pointer("pointerdown")));
  await act(async () => button.dispatchEvent(pointer("pointerout")));
  await act(async () => vi.advanceTimersByTime(2000));
  expect(onApprove).not.toHaveBeenCalled();
});

it.each(["Enter", " "])("approves a held %j key, not a tap of it", async (name) => {
  const button = await render();
  const down = key("keydown", name);
  await act(async () => button.dispatchEvent(down));
  // The browser's own click for this key is held back.
  expect(down.defaultPrevented).toBe(true);
  await act(async () => button.dispatchEvent(key("keydown", name, true)));
  await act(async () => vi.advanceTimersByTime(800));
  expect(onApprove).toHaveBeenCalledTimes(1);

  await act(async () => button.dispatchEvent(key("keydown", name)));
  await act(async () => vi.advanceTimersByTime(300));
  const up = key("keyup", name);
  await act(async () => button.dispatchEvent(up));
  expect(up.defaultPrevented).toBe(true);
  await act(async () => vi.advanceTimersByTime(2000));
  expect(onApprove).toHaveBeenCalledTimes(1);
});

it("lets go when focus leaves during a key hold", async () => {
  const button = await render();
  await act(async () => button.dispatchEvent(key("keydown", "Enter")));
  await act(async () => button.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  await act(async () => vi.advanceTimersByTime(2000));
  expect(onApprove).not.toHaveBeenCalled();
});

it("approves a click that has no pointer behind it, as a screen reader sends", async () => {
  const button = await render();
  await act(async () => button.click());
  expect(onApprove).toHaveBeenCalledTimes(1);
});

it("is a plain confirm button with reduced motion", async () => {
  matchMedia(true);
  const button = await render();
  expect(button.textContent).toBe("Allow once");
  expect(container.querySelector("[data-testid=hold-fill]")).toBeNull();
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  });
  expect(onApprove).toHaveBeenCalledTimes(1);
});

it("shows the sending words on a disabled button while the answer goes", async () => {
  const button = await render({ busy: "Sending…" });
  expect(button.textContent).toBe("Sending…");
  expect(button.disabled).toBe(true);
});

it("does not start a hold on a disabled button", async () => {
  const button = await render({ disabled: true });
  await act(async () => button.dispatchEvent(pointer("pointerdown")));
  await act(async () => vi.advanceTimersByTime(2000));
  expect(onApprove).not.toHaveBeenCalled();
});

it("ignores a press of another mouse button", async () => {
  const button = await render();
  await act(async () =>
    button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 2 })),
  );
  await act(async () => vi.advanceTimersByTime(2000));
  expect(onApprove).not.toHaveBeenCalled();
});
