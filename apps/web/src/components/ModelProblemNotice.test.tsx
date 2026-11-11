// @vitest-environment jsdom

import type { ModelProblem } from "@corvo/core";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelProblemNotice } from "./ModelProblemNotice";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const authProblem: ModelProblem = {
  kind: "auth",
  line: "Your model provider sign-in is no longer valid.",
  action: "sign-in",
  details: "401 unauthorized",
  retry: true,
};

async function render(ui: React.ReactElement) {
  await act(async () => root.render(ui));
}

const button = (label: string) =>
  [...container.querySelectorAll("button")].find((item) => item.textContent === label);

describe("ModelProblemNotice", () => {
  it("renders the line inside an alert", async () => {
    await render(<ModelProblemNotice problem={authProblem} />);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(authProblem.line);
  });

  it("runs the action", async () => {
    const onAction = vi.fn();
    await render(<ModelProblemNotice problem={authProblem} onAction={onAction} />);
    await act(async () => button("Sign in again")?.click());
    expect(onAction).toHaveBeenCalledWith("sign-in");
  });

  it("shows no action button without a handler", async () => {
    await render(<ModelProblemNotice problem={authProblem} />);
    expect(button("Sign in again")).toBeUndefined();
  });

  it("retries once and disables Try again while retrying", async () => {
    const onRetry = vi.fn();
    await render(<ModelProblemNotice problem={authProblem} onRetry={onRetry} />);
    await act(async () => button("Try again")?.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
    await render(<ModelProblemNotice problem={authProblem} onRetry={onRetry} retrying />);
    expect(button("Try again")?.disabled).toBe(true);
  });

  it("hides Try again when retrying cannot help", async () => {
    await render(
      <ModelProblemNotice problem={{ ...authProblem, retry: false }} onRetry={vi.fn()} />,
    );
    expect(button("Try again")).toBeUndefined();
  });

  it("collapses Details and omits it without raw text", async () => {
    await render(<ModelProblemNotice problem={authProblem} />);
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
    await render(<ModelProblemNotice problem={{ ...authProblem, details: undefined }} />);
    expect(container.querySelector("details")).toBeNull();
  });
});
