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
import { ContinueButton, OnboardingLayout } from "./OnboardingLayout";

const steps: { id: OnboardingStepId; label: string; detail?: string }[] = [
  { id: "workspace", label: "Workspace", detail: "Alves Studio" },
  { id: "start", label: "Use" },
  { id: "bot", label: "First bot" },
  { id: "computer", label: "Computer" },
];

let container: HTMLDivElement;
let root: Root;

function render(props: {
  current?: OnboardingStepId;
  done?: OnboardingStepId[];
  onBack?: () => void;
  onSkip?: () => void;
  narration?: string;
  preview?: ReactNode;
}) {
  act(() =>
    root.render(
      <OnboardingLayout
        steps={steps}
        current={props.current ?? "start"}
        done={new Set(props.done ?? ["workspace"])}
        onBack={props.onBack}
        onSkip={props.onSkip}
        narration={props.narration}
        preview={props.preview}
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
    render({ done: ["workspace", "start"] });
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

  it("says how many steps are left", () => {
    render({ done: ["workspace"] });
    expect(container.querySelector('[data-testid="onboarding-rail"]')?.textContent).toContain(
      "3 steps left",
    );
    render({ done: ["workspace", "start", "bot"] });
    expect(container.querySelector('[data-testid="onboarding-rail"]')?.textContent).toContain(
      "1 step left",
    );
  });

  it("shows each finished step's answer under its title", () => {
    render({});
    const workspace = [...container.querySelectorAll("li")].find((li) =>
      li.textContent?.includes("Workspace"),
    );
    expect(workspace?.textContent).toContain("Alves Studio");
  });

  it("has the Chief say its line for the step", () => {
    render({ narration: "Hi, Ana." });
    expect(container.querySelector('[data-testid="onboarding-narration"]')?.textContent).toBe(
      "Hi, Ana.",
    );
  });

  it("shows the preview beside the step", () => {
    render({ preview: <p>mini workspace</p> });
    expect(container.querySelector('[data-testid="onboarding-preview"]')?.textContent).toBe(
      "mini workspace",
    );
  });

  it("skips from any step that offers it", () => {
    const onSkip = vi.fn();
    render({ onSkip });
    const skip = [...container.querySelectorAll("button")].find((b) => b.textContent === "Skip");
    act(() => skip?.click());
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it("presses Continue when Enter is hit with nothing focused, and shows the hint", () => {
    const onContinue = vi.fn();
    act(() =>
      root.render(
        <OnboardingLayout steps={steps} current="start" done={new Set()}>
          <ContinueButton type="button" onClick={onContinue}>
            Continue
          </ContinueButton>
        </OnboardingLayout>,
      ),
    );
    const button = container.querySelector("button[data-onboarding-continue]");
    expect(button?.querySelector("kbd")?.getAttribute("aria-hidden")).toBe("true");
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("leaves Enter alone inside a field", () => {
    const onContinue = vi.fn();
    act(() =>
      root.render(
        <OnboardingLayout steps={steps} current="start" done={new Set()}>
          <input aria-label="name" />
          <ContinueButton type="button" onClick={onContinue}>
            Continue
          </ContinueButton>
        </OnboardingLayout>,
      ),
    );
    act(() => {
      container
        .querySelector("input")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onContinue).not.toHaveBeenCalled();
  });
});
