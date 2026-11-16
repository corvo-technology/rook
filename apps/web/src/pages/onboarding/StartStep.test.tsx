// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("../ImportFlow", () => ({
  ImportFlow: ({ onBack, onFinish }: { onBack: () => void; onFinish: () => void }) => (
    <div>
      <button type="button" onClick={onBack}>
        Back
      </button>
      <button type="button" onClick={onFinish}>
        Finish import
      </button>
    </div>
  ),
}));

import { StartStep } from "./StartStep";

const onDone = vi.fn();
let container: HTMLDivElement;
let root: Root;

const button = (name: string) => {
  const found = [...container.querySelectorAll("button")].find((b) => b.textContent === name);
  if (!found) throw new Error(`no button ${name}`);
  return found;
};
const click = (name: string) => act(async () => button(name).click());

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  onDone.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<StartStep onDone={onDone} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("StartStep", () => {
  it("starts on a ready team and hands on the areas in the order tapped", async () => {
    await click("Support");
    await click("Sales");
    await click("Continue");
    expect(onDone).toHaveBeenCalledWith({ categories: ["support", "sales"] });
  });

  it("starts with only the Chief when asked", async () => {
    await click("Support");
    await click("Just the Chief");
    await click("Continue");
    expect(onDone).toHaveBeenCalledWith({ categories: [] });
  });

  it("opens the import as its own screen, and comes back from it", async () => {
    expect(container.textContent).not.toContain("Finish import");
    await click("Import");
    expect(container.textContent).not.toContain("Just the Chief");
    await click("Back");
    expect(button("Just the Chief")).toBeTruthy();
  });

  it("goes on to the next step once the import is finished", async () => {
    await click("Import");
    await click("Finish import");
    expect(onDone).toHaveBeenCalledWith({ categories: [] });
  });
});
