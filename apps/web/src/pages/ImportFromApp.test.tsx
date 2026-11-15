// @vitest-environment jsdom

import type { ImportFromAppPreview } from "@corvo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const importFromApp = vi.fn();
const importSpace = vi.fn();
vi.mock("../lib/space-rpc", () => ({
  useSpaceRpc: () => ({ bots: { importFromApp, importSpace } }),
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
vi.mock("../lib/user-error", () => ({
  errorText: (error: unknown) => (error instanceof Error ? error.message : "Something went wrong"),
}));
vi.mock("../components/ai/primitives", () => ({
  SuccessPop: ({ label }: { label: string }) => <span>{label}</span>,
}));
vi.mock("../lib/app-import-files", () => ({ readAppImportFiles: vi.fn(async () => null) }));

import { ImportFromApp } from "./ImportFromApp";

const preview: ImportFromAppPreview = {
  agents: [
    { name: "Sales Coach", title: "Coaches sales", instructions: "Be direct.", exists: false },
  ],
  skills: ["pdf"],
  routines: [{ name: "Monday brief", schedule: "0 9 * * 1" }],
  facts: 2,
  files: ["playbook.pdf"],
  connections: ["HubSpot"],
  leftOut: 1,
  space: {
    version: 1,
    kind: "space",
    exportedAt: "2026-01-01T00:00:00.000Z",
    bots: [],
    memory: [],
    skills: [],
    wiki: [],
    wikiSettings: null,
    facts: [],
    channels: [],
    board: null,
    sections: [],
  },
};
let root: Root;
let host: HTMLDivElement;

const button = (name: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === name);

async function click(name: string) {
  await act(async () => button(name)?.click());
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  importFromApp.mockReset().mockResolvedValue(preview);
  importSpace.mockReset().mockResolvedValue({
    added: ["Sales Coach"],
    existing: [],
    skills: 1,
    routines: 1,
    skippedRoutines: 0,
    skippedFiles: 0,
    wikiPages: 0,
    facts: 2,
    channels: 0,
    tickets: 0,
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<ImportFromApp />));
  await click("Import from another app");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("ImportFromApp", () => {
  it("previews the pasted answer, then imports the translated space", async () => {
    const textarea = document.querySelector("textarea");
    if (!textarea) throw new Error("no textarea");
    expect(button("Preview")?.disabled).toBe(true);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        '{"name":"Sales Coach"}',
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Preview");
    expect(importFromApp).toHaveBeenCalledWith({
      source: "prompt",
      text: '{"name":"Sales Coach"}',
    });
    const body = document.querySelector("[data-testid=app-import-preview]")?.textContent ?? "";
    for (const shown of [
      "Sales Coach",
      "pdf",
      "Monday brief",
      "Start paused",
      "2 facts to review",
      "playbook.pdf",
      "HubSpot",
      "1 item left out",
    ]) {
      expect(body).toContain(shown);
    }
    await click("Import");
    expect(importSpace).toHaveBeenCalledWith(preview.space);
    expect(document.body.textContent).toContain("Added 1 agent, 1 skill, 1 routine (paused).");
  });

  it("says so when the answer cannot be read, and keeps what was pasted", async () => {
    importFromApp.mockRejectedValueOnce(new Error("No agent found."));
    const textarea = document.querySelector("textarea");
    if (!textarea) throw new Error("no textarea");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        "hi",
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Preview");
    expect(document.querySelector("[role=alert]")?.textContent).toContain("No agent found.");
    expect(importSpace).not.toHaveBeenCalled();
  });

  it("does not offer to import what is already in the space", async () => {
    importFromApp.mockResolvedValueOnce({
      ...preview,
      agents: [{ ...preview.agents[0], exists: true }],
      skills: [],
      facts: 0,
    });
    const textarea = document.querySelector("textarea");
    if (!textarea) throw new Error("no textarea");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        "x",
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Preview");
    expect(button("Import")?.disabled).toBe(true);
  });
});
