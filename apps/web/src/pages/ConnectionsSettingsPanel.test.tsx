// @vitest-environment jsdom
import type * as UiWeb from "@corvo/ui-web";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  connections: { status: vi.fn(), save: vi.fn() },
}));
vi.mock("../lib/desktop", () => ({ desktopBridge: () => bridge }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => text + part + (values[index] ?? ""), "");
  return {
    useLingui: () => ({ t, i18n: { locale: "en" } }),
    Trans: ({ children }: { children: ReactNode }) => children,
  };
});
vi.mock("@corvo/ui-web", async () => ({
  InlineConfirm: (await vi.importActual<typeof UiWeb>("@corvo/ui-web")).InlineConfirm,
  Button: (props: ComponentProps<"button">) => <button type="button" {...props} />,
  Input: (props: ComponentProps<"input">) => <input {...props} />,
}));

import { ConnectionsSettingsPanel } from "./ConnectionsSettingsPanel";

async function render() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ConnectionsSettingsPanel />);
  });
  await act(async () => {});
  return { container, root };
}
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = "";
  bridge.connections.status.mockReset().mockResolvedValue({ composio: false, telegram: false });
  bridge.connections.save.mockReset();
});

it("saves a pasted Telegram token and shows it as connected without showing the token", async () => {
  bridge.connections.save.mockResolvedValue({ composio: false, telegram: true });
  const { container } = await render();
  const input = container.querySelector<HTMLInputElement>('input[name="telegramBotToken"]')!;
  expect(input.type).toBe("password");
  await type(input, "123:abc");
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-testid="save-telegram"]')!.click();
  });
  expect(bridge.connections.save).toHaveBeenCalledWith({ telegramBotToken: "123:abc" });
  expect(container.querySelector('input[name="telegramBotToken"]')).toBeNull();
  expect(container.textContent).not.toContain("123:abc");
  expect(container.querySelector('[data-testid="remove-telegram"]')).not.toBeNull();
});

it("removes a saved Composio key", async () => {
  bridge.connections.status.mockResolvedValue({ composio: true, telegram: false });
  bridge.connections.save.mockResolvedValue({ composio: false, telegram: false });
  const { container } = await render();
  const remove = () =>
    container.querySelector<HTMLButtonElement>('[data-testid="remove-composio"]')!;
  await act(async () => remove().click());
  expect(bridge.connections.save).not.toHaveBeenCalled();
  expect(remove().textContent).toBe("Remove Composio?");
  await act(async () => remove().click());
  expect(bridge.connections.save).toHaveBeenCalledWith({ composioApiKey: null });
  expect(container.querySelector('input[name="composioApiKey"]')).not.toBeNull();
});

it("keeps the field and says so when saving fails", async () => {
  bridge.connections.save.mockRejectedValue(new Error("That key is not valid."));
  const { container } = await render();
  await type(container.querySelector<HTMLInputElement>('input[name="composioApiKey"]')!, "x");
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-testid="save-composio"]')!.click();
  });
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.querySelector('input[name="composioApiKey"]')).not.toBeNull();
});
