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

import type { OnboardingStepId } from "../../lib/onboarding-steps";
import { OnboardingLayout } from "./OnboardingLayout";

const steps: { id: OnboardingStepId; label: string; detail?: string }[] = [
  { id: "workspace", label: "Workspace", detail: "Alves Studio" },
  { id: "survey", label: "Use" },
  { id: "bot", label: "First bot" },
  { id: "computer", label: "Computer" },
];

let container: HTMLDivElement;
let root: Root;

function render(props: {
  current?: OnboardingStepId;
  done?: OnboardingStepId[];
  onBack?: () => void;
}) {
  act(() =>
    root.render(
      <OnboardingLayout
        steps={steps}
        current={props.current ?? "survey"}
        done={new Set(props.done ?? ["workspace"])}
        onBack={props.onBack}
      >
        <p>content</p>
      </OnboardingLayout>,
    ),
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("OnboardingLayout", () => {
  it("lists every step and marks the current one", () => {
    render({});
    for (const step of steps) expect(container.textContent).toContain(step.label);
    const current = container.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toContain("Use");
  });

  it("says in text that a step is completed, not by color alone", () => {
    render({});
    const workspace = [...container.querySelectorAll("li")].find((li) =>
      li.textContent?.includes("Workspace"),
    );
    expect(workspace?.textContent).toContain("Completed");
  });

  it("derives the progress bar from the completed steps", () => {
    render({ done: ["workspace", "survey"] });
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("50");
  });

  it("shows Back only when it can go back", () => {
    render({});
    expect(container.textContent).not.toContain("Back");
    const onBack = vi.fn();
    render({ onBack });
    const back = [...container.querySelectorAll("button")].find((b) => b.textContent === "Back");
    act(() => back?.click());
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("rests one guide rook above the current step, and the same one for the next", () => {
    render({ current: "survey" });
    const rook = container.querySelector("[data-guide-rook]");
    expect(container.querySelectorAll("[data-guide-rook]")).toHaveLength(1);
    expect(rook?.getAttribute("data-guide-rook")).toBe("survey");
    expect(container.querySelectorAll("[data-guide-stop]")).toHaveLength(steps.length);

    render({ current: "bot" });
    expect(container.querySelector("[data-guide-rook]")).toBe(rook);
    expect(rook?.getAttribute("data-guide-rook")).toBe("bot");
  });
});
