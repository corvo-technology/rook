// @vitest-environment jsdom

import type { ModelCatalogEntry } from "@corvo/contracts";
import { i18n } from "@lingui/core";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => ({
  models: { probeCatalog: vi.fn(), connect: vi.fn() },
}));
vi.mock("../lib/rpc", () => ({ rpc: rpcMock }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

import { QuickKeyConnect } from "./onboarding-quick-connect";

const catalog = [
  { provider: "openrouter", providerName: "OpenRouter", id: "openai/gpt-x", recommended: true },
  { provider: "anthropic", providerName: "Anthropic", id: "claude-x", recommended: true },
] as unknown as ModelCatalogEntry[];

let container: HTMLDivElement;
let root: Root;
const onSelectProvider = vi.fn();
const onMore = vi.fn();
const onConnected = vi.fn();

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  rpcMock.models.probeCatalog.mockReset().mockResolvedValue({ models: ["openai/gpt-x"] });
  rpcMock.models.connect.mockReset().mockResolvedValue({});
  for (const fn of [onSelectProvider, onMore, onConnected]) fn.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  delete (window as { corvoDesktop?: unknown }).corvoDesktop;
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(
      <QuickKeyConnect
        catalog={catalog}
        signInOptions={[
          { value: "openai-codex", label: "ChatGPT subscription" },
          { value: "anthropic:sign-in", label: "Claude subscription" },
        ]}
        onSelectProvider={onSelectProvider}
        onMore={onMore}
        onConnected={onConnected}
      />,
    );
  });
}

async function paste(value: string) {
  const input = container.querySelector("input") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function rejected(status: number, details: string) {
  return Object.assign(new Error(details), {
    data: { reason: "model_failure", modelFailure: { details, status } },
  });
}

const submit = () => container.querySelector('button[type="submit"]') as HTMLButtonElement;
const text = () => container.textContent ?? "";

describe("QuickKeyConnect", () => {
  it("recognizes the provider from the key and enables Continue", async () => {
    await render();
    expect(submit().disabled).toBe(true);
    await paste("sk-or-v1-abcdef123456");
    expect(text()).toContain("OpenRouter");
    expect(submit().disabled).toBe(false);
  });

  it("asks for a provider when the key is not recognized", async () => {
    await render();
    await paste("not-a-known-key");
    expect(text()).toContain("Key not recognized. Choose a provider.");
    expect(submit().disabled).toBe(true);
  });

  it("checks the key, saves it with the recommended model and moves on", async () => {
    await render();
    await paste("  sk-or-v1-abcdef123456  ");
    await act(async () => submit().click());
    expect(rpcMock.models.probeCatalog).toHaveBeenCalledWith({
      provider: "openrouter",
      apiKey: "sk-or-v1-abcdef123456",
    });
    expect(rpcMock.models.connect).toHaveBeenCalledWith({
      provider: "openrouter",
      apiKey: "sk-or-v1-abcdef123456",
      modelId: "openai/gpt-x",
      label: "OpenRouter",
    });
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it("does not save a key that the provider rejects, and says why", async () => {
    rpcMock.models.probeCatalog.mockRejectedValue(rejected(401, "invalid api key"));
    await render();
    await paste("sk-or-v1-abcdef123456");
    await act(async () => submit().click());
    expect(rpcMock.models.connect).not.toHaveBeenCalled();
    expect(onConnected).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(submit().disabled).toBe(false);
  });

  it("offers Replace key and Try again when saving fails with a rejected key", async () => {
    rpcMock.models.connect.mockRejectedValueOnce(rejected(401, "invalid api key"));
    await render();
    await paste("sk-or-v1-abcdef123456");
    await act(async () => submit().click());
    const labels = [...container.querySelectorAll("button")].map((item) => item.textContent);
    expect(labels).toContain("Replace key");
    expect(labels).toContain("Try again");
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent === "Try again")
        ?.click(),
    );
    expect(rpcMock.models.connect).toHaveBeenCalledTimes(2);
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it("shows a plain save error as it is", async () => {
    rpcMock.models.connect.mockRejectedValueOnce(new Error("Name is taken"));
    await render();
    await paste("sk-or-v1-abcdef123456");
    await act(async () => submit().click());
    expect(text()).toContain("Name is taken");
  });

  it("keeps the other ways in: a subscription sign-in and the full provider list", async () => {
    await render();
    const buttons = [...container.querySelectorAll("button")];
    await act(async () =>
      buttons.find((item) => item.textContent === "ChatGPT subscription")?.click(),
    );
    expect(onSelectProvider).toHaveBeenCalledWith("openai-codex");
    await act(async () => buttons.find((item) => item.textContent === "Other providers")?.click());
    expect(onMore).toHaveBeenCalledTimes(1);
  });

  it("offers the subscriptions first, and puts one found on this computer ahead of the other", async () => {
    (window as { corvoDesktop?: unknown }).corvoDesktop = {
      tools: { detect: async () => ({ claude: true, codex: false }) },
    };
    await render();
    const options = [...container.querySelectorAll("button[data-sign-in]")];
    expect(options.map((option) => option.textContent)).toEqual([
      "Claude subscriptionFound on this computer",
      "ChatGPT subscription",
    ]);
    await act(async () => (options[0] as HTMLButtonElement).click());
    expect(onSelectProvider).toHaveBeenCalledWith("anthropic:sign-in");
  });

  it("keeps the order and shows no badge when nothing is found or the app is not the desktop one", async () => {
    await render();
    const options = [...container.querySelectorAll("button[data-sign-in]")];
    expect(options.map((option) => option.textContent)).toEqual([
      "ChatGPT subscription",
      "Claude subscription",
    ]);
    expect(text()).not.toContain("Found on this computer");
  });
});
