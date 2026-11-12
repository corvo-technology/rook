// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: unknown }) => children,
}));
vi.mock("@corvo/ui-web", () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: React.ComponentProps<"button"> & { variant?: string; size?: string }) => (
    <button type="button" {...props} />
  ),
}));

import { MemoryFactCard, type MemoryFactCardProps } from "./MemoryFactCard";

let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function show(props: Partial<MemoryFactCardProps> = {}) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const onDecide = vi.fn();
  await act(async () => {
    root!.render(
      <MemoryFactCard
        memory={{ text: "Runs a bakery in Lisbon", state: "pending" }}
        onDecide={onDecide}
        {...props}
      />,
    );
  });
  return { container, onDecide };
}
const button = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === name);

describe("MemoryFactCard", () => {
  it("offers Save and Discard for a fact that waits, and nothing else", async () => {
    const { container, onDecide } = await show();
    expect(container.textContent).toContain("New memory");
    expect(container.textContent).toContain("Runs a bakery in Lisbon");
    expect(button(container, "Undo")).toBeUndefined();
    await act(async () => button(container, "Save")!.click());
    await act(async () => button(container, "Discard")!.click());
    expect(onDecide.mock.calls).toEqual([["save"], ["discard"]]);
  });

  it("offers Undo for a fact an agent saved on its own, which forgets it", async () => {
    const { container, onDecide } = await show({
      memory: { text: "Wakes up at five", state: "saved" },
    });
    expect(container.textContent).toContain("Remembered");
    expect(button(container, "Save")).toBeUndefined();
    await act(async () => button(container, "Undo")!.click());
    expect(onDecide).toHaveBeenCalledWith("forget");
  });

  it("shows a forgotten fact without buttons, and waits while an answer is on its way", async () => {
    const forgotten = await show({ memory: { text: "Owns a boat", state: "forgotten" } });
    expect(forgotten.container.textContent).toContain("Not remembered");
    expect(forgotten.container.querySelectorAll("button")).toHaveLength(0);
    await act(async () => root?.unmount());
    document.body.innerHTML = "";
    const busy = await show({ busy: true });
    expect(button(busy.container, "Save")!.disabled).toBe(true);
  });
});
