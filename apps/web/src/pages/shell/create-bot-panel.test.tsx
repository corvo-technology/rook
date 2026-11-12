// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateBotPanelInput } from "./create-bot-panel";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

import { CreateBotPanel } from "./create-bot-panel";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(onCreate: (input: CreateBotPanelInput) => Promise<void>) {
  await act(async () => {
    root.render(<CreateBotPanel onCancel={() => undefined} onCreate={onCreate} />);
  });
}

function button(name: string) {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.getAttribute("aria-label") === name || element.textContent === name,
  );
  if (!found) throw new Error(`No button ${name}`);
  return found;
}

async function typeName(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[placeholder="Name your Bot"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

describe("CreateBotPanel", () => {
  it("creates only once the name is not blank", async () => {
    const onCreate = vi.fn(async () => undefined);
    await render(onCreate);
    expect(button("Create").disabled).toBe(true);
    await typeName("   ");
    expect(button("Create").disabled).toBe(true);
    await typeName("  Scout  ");
    expect(button("Create").disabled).toBe(false);
  });

  it("creates the bot with the mascot color that was picked", async () => {
    const onCreate = vi.fn(async (_input: CreateBotPanelInput) => undefined);
    await render(onCreate);
    await click(button("Color #10B981"));
    expect(document.querySelector("[data-mascot]")?.getAttribute("data-mascot")).toBe("mint");
    await typeName("Scout");
    await click(button("Create"));
    expect(onCreate).toHaveBeenCalledWith({ name: "Scout", color: "#10B981" });
  });

  it("leaves the look to the server until the person picks one", async () => {
    const onCreate = vi.fn(async (_input: CreateBotPanelInput) => undefined);
    await act(async () => {
      root.render(
        <CreateBotPanel
          onCancel={() => undefined}
          onCreate={onCreate}
          takenColors={["#10B981", "#3B82F6"]}
        />,
      );
    });
    expect(document.querySelector("[data-mascot]")?.getAttribute("data-mascot")).toBe("violet");
    await typeName("Scout");
    await click(button("Create"));
    expect(onCreate).toHaveBeenCalledWith({ name: "Scout" });
  });

  it("offers every mascot color", async () => {
    await render(async () => undefined);
    const swatches = document.querySelectorAll('[data-testid="avatar-studio-colors"] button');
    expect(swatches).toHaveLength(10);
  });

  it("shows the error and stays open when creating fails", async () => {
    await render(async () => {
      throw new Error("Bot limit reached");
    });
    await typeName("Scout");
    await click(button("Create"));
    expect(document.querySelector('[data-testid="create-bot-error"]')?.textContent).toBe(
      "Bot limit reached",
    );
    expect(document.querySelector('[data-testid="create-bot-panel"]')).not.toBeNull();
  });
});

describe("importing instead", () => {
  it("offers Import only when the parent handles it", async () => {
    await render(async () => undefined);
    expect(document.querySelector('[data-testid="create-bot-import"]')).toBeNull();

    const onImport = vi.fn();
    await act(async () => {
      root.render(
        <CreateBotPanel
          onCancel={() => undefined}
          onCreate={async () => undefined}
          onImport={onImport}
        />,
      );
    });
    await act(async () => button("Import").click());
    expect(onImport).toHaveBeenCalledTimes(1);
  });
});
