// @vitest-environment jsdom

import type { ApprovalMode } from "@corvo/contracts";
import { approvalModeSummary } from "@corvo/core";
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
vi.mock(
  "@corvo/ui-web",
  async () => (await import("../test-support/ui-web-choice-doubles")).choiceDoubles,
);

import { AutonomyPicker } from "./AutonomyPicker";

const LINES = {
  every_change:
    "Still asks before anything that changes something, and before opening a site you didn't mention.",
  reviewed:
    "Still asks when a second model finds it outside your request, and before security changes.",
  steered_only:
    "Still asks before a security change after it read outside content. Blocked actions stay blocked.",
};
const HINT = "Add a model in Settings to use this.";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(props: {
  value: ApprovalMode;
  checkerAvailable: boolean;
  name?: string;
  onChange?: (mode: ApprovalMode) => void;
}) {
  const onChange = props.onChange ?? vi.fn();
  await act(async () =>
    root.render(<AutonomyPicker {...props} name={props.name ?? "Ada"} onChange={onChange} />),
  );
  return onChange;
}

const radios = () => [...container.querySelectorAll<HTMLElement>('[role="radio"]')];
const radio = (mode: string) => radios().find((r) => r.dataset.value === mode)!;
const button = (text: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === text)!;
const click = (element: HTMLElement) => act(async () => element.click());

describe("AutonomyPicker", () => {
  it("offers three answers with a model and two without", async () => {
    await render({ value: "ask", checkerAvailable: true });
    expect(radios().map((r) => r.dataset.value)).toEqual(["ask", "auto", "never"]);
    await render({ value: "ask", checkerAvailable: false });
    expect(radios().map((r) => r.dataset.value)).toEqual(["ask", "never"]);
  });

  it("keeps normal visible and selected without a model, with the hint", async () => {
    await render({ value: "auto", checkerAvailable: false });
    expect(radios().map((r) => r.dataset.value)).toEqual(["ask", "auto", "never"]);
    expect(radio("auto").getAttribute("aria-checked")).toBe("true");
    expect(container.textContent).toContain(LINES.every_change);
    expect(container.textContent).toContain(HINT);
  });

  it("names the bot in the question", async () => {
    await render({ value: "ask", checkerAvailable: true, name: "Ada" });
    expect(container.textContent).toContain("How much does Ada do on its own?");
    expect(container.textContent).toContain("Asks before any change");
    expect(container.textContent).toContain("Does what fits your request");
    expect(container.textContent).toContain("Does everything without asking");
  });

  it.each([
    ["ask", true, "every_change"],
    ["auto", true, "reviewed"],
    ["never", true, "steered_only"],
  ] as const)("shows exactly one line for %s", async (value, checkerAvailable, summary) => {
    await render({ value, checkerAvailable });
    const shown = Object.values(LINES).filter((line) => container.textContent?.includes(line));
    expect(shown).toEqual([LINES[summary]]);
    expect(container.textContent).not.toContain(HINT);
  });

  it.each(["ask", "auto", "never"] as const)(
    "shows the line the gate summary maps to for %s with and without a model",
    async (mode) => {
      for (const checkerAvailable of [true, false]) {
        await render({ value: mode, checkerAvailable });
        const summary = approvalModeSummary({ mode, checkerConfigured: checkerAvailable });
        expect(container.querySelector("[aria-live]")?.textContent).toBe(LINES[summary]);
      }
    },
  );

  it("changes at once to careful and normal", async () => {
    const onChange = await render({ value: "never", checkerAvailable: true });
    await click(radio("ask"));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("ask");
  });

  it("does nothing when the current answer is picked again", async () => {
    const onChange = await render({ value: "ask", checkerAvailable: true });
    await click(radio("ask"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("asks before choosing free, and cancelling changes nothing", async () => {
    const onChange = await render({ value: "ask", checkerAvailable: true });
    await click(radio("never"));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Let Ada act without asking?",
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(LINES.steered_only);
    expect(onChange).not.toHaveBeenCalled();
    await click(button("Cancel"));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(radio("ask").getAttribute("aria-checked")).toBe("true");
  });

  it("chooses free once confirmed", async () => {
    const onChange = await render({ value: "ask", checkerAvailable: true });
    await click(radio("never"));
    await click(button("Stop asking"));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("never");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
