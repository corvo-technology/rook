// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const importSpace = vi.fn();
vi.mock("../lib/space-rpc", () => ({
  useSpaceRpc: () => ({ bots: { importSpace }, export: { space: vi.fn() } }),
}));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return {
    useLingui: () => ({ t }),
    Trans: ({ children }: { children: ReactNode }) => children,
  };
});
vi.mock("@lingui/core/macro", () => ({
  plural: (value: number, forms: { one: string; other: string }) =>
    (value === 1 ? forms.one : forms.other).replace("#", String(value)),
}));
vi.mock("@corvo/ui-web", () => ({
  Spinner: (props: ComponentProps<"svg">) => <svg data-testid="spinner" {...props} />,
  Button: (props: ComponentProps<"button">) => <button type="button" {...props} />,
}));

import { SpaceTransfer } from "./SpaceTransfer";

const validFile = JSON.stringify({
  version: 1,
  kind: "space",
  exportedAt: "2026-01-01T00:00:00.000Z",
  bots: [],
  memory: [],
  skills: [],
});
let host: HTMLDivElement;
let root: Root;

async function pickFile(name: string) {
  const input = host.querySelector<HTMLInputElement>("input[type=file]");
  if (!input) throw new Error("no file input");
  const file = new File([validFile], name, { type: "application/json" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  importSpace.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<SpaceTransfer spaceName="Acme" />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("SpaceTransfer", () => {
  it("shows progress while importing, then the result", async () => {
    let finish: (value: unknown) => void = () => {};
    importSpace.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await pickFile("acme-space.json");
    const buttons = [...host.querySelectorAll("button")];
    expect(host.querySelector("[data-testid=spinner]")).not.toBeNull();
    expect(buttons.map((b) => b.textContent)).toEqual(["Export space", "Importing…"]);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(buttons[1]?.getAttribute("aria-busy")).toBe("true");
    expect(host.textContent).toContain("Importing acme-space.json…");

    await act(async () =>
      finish({ added: ["a", "b"], wikiPages: 0, channels: 0, tickets: 0, routines: 0 }),
    );
    expect(host.querySelector("[data-testid=spinner]")).toBeNull();
    expect(host.textContent).toContain("Added 2 bots.");
    expect(host.textContent).not.toContain("Importing acme-space.json…");
  });

  it("says everything is already here when nothing was added", async () => {
    importSpace.mockResolvedValue({
      added: [],
      wikiPages: 0,
      channels: 0,
      tickets: 0,
      routines: 0,
    });
    await pickFile("acme-space.json");
    expect(host.textContent).toContain("Everything in this file is already here.");
    expect(host.textContent).not.toContain("Added 0 bots");
  });
});
