// @vitest-environment jsdom

import type { LocalSetupReport } from "@corvo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => ({
  models: { testLocal: vi.fn(), useLocal: vi.fn() },
}));
vi.mock("../../lib/rpc", () => ({ rpc: rpcMock }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

import { LocalModelChoice } from "./LocalModelChoice";

const report: LocalSetupReport = {
  enabled: true,
  checking: false,
  checkedAt: 1,
  options: [
    {
      id: "server:11434",
      kind: "server",
      label: "Ollama",
      provider: "openai-compatible",
      models: ["fake-model", "other-model"],
      modelId: "fake-model",
      backgroundModelId: null,
      testable: true,
    },
    {
      id: "connection:one",
      kind: "connection",
      label: "Signed-in account",
      provider: "acme",
      credentialId: "one",
      models: ["acme-model"],
      modelId: "acme-model",
      backgroundModelId: null,
      testable: false,
    },
  ],
};

let container: HTMLDivElement;
let root: Root;
const onContinue = vi.fn();
const onFallback = vi.fn();

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  rpcMock.models.testLocal.mockReset();
  rpcMock.models.useLocal.mockReset().mockResolvedValue({ ok: true });
  onContinue.mockReset();
  onFallback.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(
      <LocalModelChoice report={report} onContinue={onContinue} onFallback={onFallback} />,
    );
  });
}

const button = (name: string) =>
  [...container.querySelectorAll("button")].find(
    (item) => item.getAttribute("aria-label") === name || item.textContent === name,
  );
const text = () => container.textContent ?? "";

describe("LocalModelChoice", () => {
  it("preselects the first option and its model", async () => {
    await render();
    const radios = [...container.querySelectorAll('[role="radio"]')];
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(radios[0]?.getAttribute("aria-label")).toBe("Ollama");
    expect(container.querySelector('[aria-label="Model"]')?.textContent).toContain("fake-model");
  });

  it("Continue calls useLocal with the chosen ids and then onContinue", async () => {
    await render();
    await act(async () => button("Continue")?.click());
    expect(rpcMock.models.useLocal).toHaveBeenCalledWith({
      optionId: "server:11434",
      modelId: "fake-model",
    });
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("does not continue and says why when saving fails", async () => {
    rpcMock.models.useLocal.mockRejectedValue(new Error("Server stopped"));
    await render();
    await act(async () => button("Continue")?.click());
    expect(onContinue).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Server stopped");
  });

  it("Test shows the answer time", async () => {
    rpcMock.models.testLocal.mockResolvedValue({ ok: true, ms: 1400 });
    await render();
    await act(async () => button("Test Ollama")?.click());
    expect(rpcMock.models.testLocal).toHaveBeenCalledWith({
      optionId: "server:11434",
      modelId: "fake-model",
    });
    expect(text()).toContain("Answered in 1.4 s");
  });

  it("a failed test shows the error summary", async () => {
    rpcMock.models.testLocal.mockResolvedValue({
      ok: false,
      ms: 20,
      error: "Ollama couldn't be reached. Check that it's running.",
    });
    await render();
    await act(async () => button("Test Ollama")?.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Ollama couldn't be reached. Check that it's running.",
    );
  });

  it("no Test button for an option that is not testable", async () => {
    await render();
    expect(button("Test Signed-in account")).toBeUndefined();
    expect(button("Test Ollama")).toBeDefined();
  });

  it("Other ways to connect calls onFallback", async () => {
    await render();
    await act(async () => button("Other ways to connect")?.click());
    expect(onFallback).toHaveBeenCalledTimes(1);
  });
});
