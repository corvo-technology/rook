// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, index) => `${text}${part}${values[index] ?? ""}`, ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@corvo/ui-web", () => ({
  Button: (props: React.ComponentProps<"button">) => <button type="button" {...props} />,
  Textarea: (props: React.ComponentProps<"textarea">) => <textarea {...props} />,
}));

import { MessageEditor, VersionSwitcher } from "./message-versions";

let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function render(node: ReactNode) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(node));
  return container;
}
const press = (container: HTMLElement, name: string) =>
  act(async () =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)?.click(),
  );

describe("the version switcher", () => {
  const variants = { index: 1, count: 3, branchIds: [null, "b1", "b2"] };

  it("says where the version on screen sits and steps to its neighbours", async () => {
    const onSwitch = vi.fn(async () => undefined);
    const container = await render(
      <VersionSwitcher variants={variants} disabled={false} onSwitch={onSwitch} />,
    );
    expect(container.textContent).toContain("2 of 3");
    await press(container, "Previous version");
    expect(onSwitch).toHaveBeenLastCalledWith(null);
    await press(container, "Next version");
    expect(onSwitch).toHaveBeenLastCalledWith("b2");
  });

  it("stops at either end and while a reply is being written", async () => {
    const first = await render(
      <VersionSwitcher
        variants={{ ...variants, index: 0 }}
        disabled={false}
        onSwitch={vi.fn(async () => undefined)}
      />,
    );
    expect(
      first.querySelector<HTMLButtonElement>('[aria-label="Previous version"]')?.disabled,
    ).toBe(true);
    expect(first.querySelector<HTMLButtonElement>('[aria-label="Next version"]')?.disabled).toBe(
      false,
    );
    await act(async () => root?.unmount());
    const busy = await render(
      <VersionSwitcher variants={variants} disabled onSwitch={vi.fn(async () => undefined)} />,
    );
    expect(busy.querySelector<HTMLButtonElement>('[aria-label="Next version"]')?.disabled).toBe(
      true,
    );
  });
});

describe("the message editor", () => {
  it("saves the trimmed text and closes", async () => {
    const onSave = vi.fn(async () => undefined);
    const onCancel = vi.fn();
    const container = await render(
      <MessageEditor initial="hello" onSave={onSave} onCancel={onCancel} />,
    );
    const field = container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      set?.call(field, "  hello again  ");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Save")?.click(),
    );
    expect(onSave).toHaveBeenCalledWith("hello again");
    expect(onCancel).toHaveBeenCalled();
  });

  it("stays open with the text when saving fails", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("no");
    });
    const onCancel = vi.fn();
    const container = await render(
      <MessageEditor initial="hello" onSave={onSave} onCancel={onCancel} />,
    );
    await act(async () =>
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Save")?.click(),
    );
    expect(onCancel).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")?.value).toBe("hello");
  });
});
