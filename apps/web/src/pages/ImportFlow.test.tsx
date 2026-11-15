// @vitest-environment jsdom

import type { ImportFromAppPreview } from "@corvo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const importFromApp = vi.fn();
const importSpace = vi.fn();
const list = vi.fn();
vi.mock("../lib/space-rpc", () => ({
  useSpaceRpc: () => ({ bots: { importFromApp, importSpace, list } }),
}));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
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
const readAppImportFiles = vi.fn();
vi.mock("../lib/app-import-files", () => ({
  readAppImportFiles: (files: File[]) => readAppImportFiles(files),
}));

import { ImportFlow } from "./ImportFlow";

const emptySpace = {
  version: 1 as const,
  kind: "space" as const,
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
};
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
  space: emptySpace,
};
const result = {
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
  modelsReset: 0,
};
const rookFile = JSON.stringify({
  ...emptySpace,
  bots: [
    {
      bot: { name: "Ana", title: "", description: "", instructions: "Be kind." },
      memory: [],
      routines: [
        {
          name: "Local brief",
          prompt: "Go",
          crons: ["0 9 * * *"],
          timezone: "UTC",
          modelProvider: "cli-engine",
          modelId: "claude/sonnet",
        },
      ],
      files: [],
    },
  ],
});

let root: Root;
let host: HTMLDivElement;
const onFinish = vi.fn();
const onBack = vi.fn();

const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
const click = (name: string) => act(async () => button(name)?.click());

async function choose(testId: string, files: File[]) {
  const input = host.querySelector<HTMLInputElement>(`[data-testid=${testId}]`);
  if (!input) throw new Error(`no input ${testId}`);
  Object.defineProperty(input, "files", { value: files, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function paste(value: string) {
  const textarea = host.querySelector("textarea");
  if (!textarea) throw new Error("no textarea");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      textarea,
      value,
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const fileWithText = (name: string, text: string) =>
  Object.assign(new File([text], name), { text: async () => text });

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const mock of [importFromApp, importSpace, list, readAppImportFiles, onFinish, onBack]) {
    mock.mockReset();
  }
  importFromApp.mockResolvedValue(preview);
  importSpace.mockResolvedValue(result);
  list.mockResolvedValue([]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<ImportFlow onBack={onBack} onFinish={onFinish} />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("ImportFlow", () => {
  it("offers every source on one screen", () => {
    for (const label of ["Rook", "ChatGPT", "Claude", "Gemini", "Grok", "SKILL.md", ".md .txt"]) {
      expect(button(label)).toBeTruthy();
    }
  });

  for (const app of ["ChatGPT", "Claude", "Gemini", "Grok"]) {
    it(`${app}: previews the pasted answer, then imports the translated space`, async () => {
      await click(app);
      expect(button("Preview")?.disabled).toBe(true);
      await paste('{"name":"Sales Coach"}');
      await click("Preview");
      expect(importFromApp).toHaveBeenCalledWith({
        source: "prompt",
        text: '{"name":"Sales Coach"}',
      });
      const body = host.querySelector("[data-testid=app-import-preview]")?.textContent ?? "";
      for (const shown of ["Sales Coach", "pdf", "Monday brief", "Start paused", "HubSpot"]) {
        expect(body).toContain(shown);
      }
      await click("Import");
      expect(importSpace).toHaveBeenCalledWith(preview.space);
      expect(host.textContent).toContain("Added 1 agent, 1 skill, 1 routine (paused).");
      expect(host.querySelector("[data-testid=imported-agents]")?.textContent).toBe("Sales Coach");
      await click("Continue");
      expect(onFinish).toHaveBeenCalledTimes(1);
    });
  }

  it("Skills and Text file: read the files into the shared preview", async () => {
    readAppImportFiles.mockResolvedValueOnce({ source: "skills", files: [] });
    await choose("import-skill-files", [fileWithText("pdf.zip", "")]);
    expect(importFromApp).toHaveBeenLastCalledWith({ source: "skills", files: [] });
    await click("Back");

    readAppImportFiles.mockResolvedValueOnce({ source: "text", name: "Ana", content: "Help." });
    await choose("import-text-file", [fileWithText("ana.md", "Help.")]);
    expect(importFromApp).toHaveBeenLastCalledWith({
      source: "text",
      name: "Ana",
      content: "Help.",
    });
    await click("Import");
    expect(importSpace).toHaveBeenCalledWith(preview.space);
  });

  it("says so when the files hold nothing to import", async () => {
    readAppImportFiles.mockResolvedValueOnce(null);
    await choose("import-text-file", [fileWithText("x.md", "")]);
    expect(host.querySelector("[role=alert]")?.textContent).toBe(
      "Nothing to import in these files.",
    );
    expect(importFromApp).not.toHaveBeenCalled();
  });

  it("Rook: previews a space file against the agents already there, then imports it whole", async () => {
    list.mockResolvedValue([{ name: "Bia" }]);
    await choose("import-rook-file", [fileWithText("space.json", rookFile)]);
    expect(importFromApp).not.toHaveBeenCalled();
    const body = host.querySelector("[data-testid=app-import-preview]")?.textContent ?? "";
    expect(body).toContain("Ana");
    expect(body).toContain("Local brief");
    await click("Import");
    expect(importSpace).toHaveBeenCalledTimes(1);
    expect(importSpace.mock.calls[0]?.[0].bots[0].bot.name).toBe("Ana");
  });

  it("Rook: refuses a file that is not a space file", async () => {
    await choose("import-rook-file", [fileWithText("x.json", '{"hello":1}')]);
    expect(host.querySelector("[role=alert]")?.textContent).toBe("This isn't a Rook space file.");
  });

  it("tells when routines moved to the space's model and keeps going", async () => {
    importSpace.mockResolvedValue({ ...result, modelsReset: 2 });
    await choose("import-rook-file", [fileWithText("space.json", rookFile)]);
    await click("Import");
    expect(host.textContent).toContain("2 routines now use this space's model.");
  });

  it("resumes after an import was already made: nothing new, so it only continues", async () => {
    list.mockResolvedValue([{ name: "Ana" }]);
    await choose("import-rook-file", [fileWithText("space.json", rookFile)]);
    expect(button("Import")).toBeUndefined();
    expect(host.textContent).toContain("Already here");
    await click("Continue");
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(importSpace).not.toHaveBeenCalled();
  });

  it("keeps the preview and shows the error when the import fails", async () => {
    importSpace.mockRejectedValueOnce(new Error("You can't add agents here."));
    await choose("import-rook-file", [fileWithText("space.json", rookFile)]);
    await click("Import");
    expect(host.querySelector("[role=alert]")?.textContent).toBe("You can't add agents here.");
    expect(button("Import")).toBeTruthy();
  });

  it("goes back to the start from the sources", async () => {
    await click("Back");
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
