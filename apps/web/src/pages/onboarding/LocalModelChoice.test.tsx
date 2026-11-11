// @vitest-environment jsdom

import type { LocalSetupReport } from "@corvo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => ({
  models: { testLocal: vi.fn(), useLocal: vi.fn() },
  engines: {
    setupState: vi.fn(),
    install: vi.fn(),
    signIn: vi.fn(),
    loginScreen: vi.fn(),
    loginInput: vi.fn(),
    cancelLogin: vi.fn(),
  },
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
  for (const fn of Object.values(rpcMock.engines)) fn.mockReset();
  rpcMock.engines.cancelLogin.mockResolvedValue({ ok: true });
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

async function render(shown: LocalSetupReport = report, onRefresh = vi.fn()) {
  await act(async () => {
    root.render(
      <LocalModelChoice
        report={shown}
        onContinue={onContinue}
        onFallback={onFallback}
        onRefresh={onRefresh}
      />,
    );
  });
  return onRefresh;
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

  describe("coding-agent CLIs", () => {
    const engine = (state: "missing" | "signed_out" | "ready") => ({
      id: "claude" as const,
      state,
      version: state === "missing" ? null : "2.5.0",
      models: [],
      checkedAt: "2026-01-01T00:00:00.000Z",
    });
    const withEngine = (state: "missing" | "signed_out" | "ready"): LocalSetupReport => ({
      ...report,
      cliEngines: [engine(state)],
    });

    it("Install appears only for an installable CLI that is not installed", async () => {
      rpcMock.engines.setupState.mockResolvedValue([
        { id: "claude", installable: true, signIn: "terminal" },
      ]);
      await render(withEngine("missing"));
      expect(button("Install")).toBeDefined();
      expect(button("Sign in")).toBeUndefined();
      await act(async () => root.unmount());
      root = createRoot(container);
      rpcMock.engines.setupState.mockResolvedValue([
        { id: "claude", installable: false, signIn: null },
      ]);
      await render(withEngine("missing"));
      expect(button("Install")).toBeUndefined();
    });

    it("Sign in appears only for an installed CLI that is signed out", async () => {
      rpcMock.engines.setupState.mockResolvedValue([
        { id: "claude", installable: true, signIn: "browser" },
      ]);
      await render(withEngine("signed_out"));
      expect(button("Sign in")).toBeDefined();
      expect(button("Install")).toBeUndefined();
    });

    it("nothing is offered for a CLI that is ready", async () => {
      await render(withEngine("ready"));
      expect(rpcMock.engines.setupState).not.toHaveBeenCalled();
      expect(button("Install")).toBeUndefined();
      expect(button("Sign in")).toBeUndefined();
    });

    it("a mismatch shows the nothing-installed sentence", async () => {
      rpcMock.engines.setupState.mockResolvedValue([
        { id: "claude", installable: true, signIn: "terminal" },
      ]);
      rpcMock.engines.install.mockResolvedValue({ state: "mismatch" });
      const onRefresh = await render(withEngine("missing"));
      await act(async () => button("Install")?.click());
      expect(text()).toContain(
        "The download did not match the published file. Nothing was installed.",
      );
      expect(onRefresh).not.toHaveBeenCalled();
    });

    it("a finished install asks for a fresh report", async () => {
      rpcMock.engines.setupState.mockResolvedValue([
        { id: "claude", installable: true, signIn: "terminal" },
      ]);
      rpcMock.engines.install.mockResolvedValue({ state: "installed" });
      const onRefresh = await render(withEngine("missing"));
      await act(async () => button("Install")?.click());
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it("the relay renders lines and sends typed text", async () => {
      vi.useFakeTimers();
      try {
        rpcMock.engines.setupState.mockResolvedValue([
          { id: "claude", installable: true, signIn: "terminal" },
        ]);
        rpcMock.engines.signIn.mockResolvedValue({ sessionId: "s1", mode: "terminal" });
        rpcMock.engines.loginScreen.mockResolvedValue({
          state: "running",
          lines: ["Paste the code:"],
        });
        rpcMock.engines.loginInput.mockResolvedValue({ ok: true });
        await render(withEngine("signed_out"));
        await act(async () => button("Sign in")?.click());
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1_600);
        });
        expect(container.querySelector("pre")?.textContent).toBe("Paste the code:");
        const input = container.querySelector(
          'input[aria-label="Terminal input"]',
        ) as HTMLInputElement;
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
            input,
            "abc-123",
          );
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => {
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        });
        expect(rpcMock.engines.loginInput).toHaveBeenCalledWith({
          sessionId: "s1",
          text: "abc-123",
          key: "enter",
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
