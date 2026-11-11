// @vitest-environment jsdom

import type { LocalSetupReport } from "@corvo/contracts";
import { DISABLED_LOCAL_SETUP } from "@corvo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => ({
  models: {
    localSetup: vi.fn(),
    testLocal: vi.fn(),
    useLocal: vi.fn(),
    probeCatalog: vi.fn(),
    connect: vi.fn(),
  },
}));
vi.mock("../../lib/rpc", () => ({ rpc: rpcMock }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

import { LocalModelStep } from "./LocalModelStep";

const found: LocalSetupReport = {
  enabled: true,
  checking: false,
  checkedAt: 1,
  options: [
    {
      id: "server:11434",
      kind: "server",
      label: "Ollama",
      provider: "openai-compatible",
      models: ["fake-model"],
      modelId: "fake-model",
      backgroundModelId: null,
      testable: true,
    },
  ],
};
const empty: LocalSetupReport = { ...found, options: [] };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const fn of Object.values(rpcMock.models)) fn.mockReset();
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
      <LocalModelStep
        catalog={[]}
        signInOptions={[]}
        onSelectProvider={vi.fn()}
        onMore={vi.fn()}
        onConnected={vi.fn()}
      />,
    );
  });
}

async function type(value: string) {
  const input = container.querySelector("input") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("LocalModelStep", () => {
  it("a late report does not replace the key field while typing", async () => {
    let resolveFresh: (report: LocalSetupReport) => void = () => undefined;
    rpcMock.models.localSetup
      .mockResolvedValueOnce(empty)
      .mockReturnValueOnce(new Promise((resolve) => (resolveFresh = resolve)));
    await render();
    await type("sk-or-v1-abc");
    await act(async () => resolveFresh(found));
    expect(container.querySelector('input[aria-label="API key"]')).not.toBeNull();
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    expect((container.querySelector("input") as HTMLInputElement).value).toBe("sk-or-v1-abc");
  });

  it("shows what was found, and the key field after Other ways to connect", async () => {
    rpcMock.models.localSetup.mockResolvedValue(found);
    await render();
    expect(container.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="API key"]')).toBeNull();
    const link = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === "Other ways to connect",
    );
    await act(async () => link?.click());
    expect(container.querySelector('input[aria-label="API key"]')).not.toBeNull();
  });

  it("disabled report renders today's step", async () => {
    rpcMock.models.localSetup.mockResolvedValue(DISABLED_LOCAL_SETUP);
    await render();
    expect(container.querySelector('input[aria-label="API key"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Found on this computer");
    expect(rpcMock.models.localSetup).toHaveBeenCalledTimes(1);
  });

  it("is today's step while nothing has been reported", async () => {
    rpcMock.models.localSetup.mockReturnValue(new Promise(() => undefined));
    await render();
    expect(container.querySelector('input[aria-label="API key"]')).not.toBeNull();
  });
});
