// @vitest-environment jsdom

import type { RunErrorInfo } from "@corvo/contracts";
import { i18n } from "@lingui/core";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
}));

import { RunErrorCard } from "./RunErrorCard";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  i18n.load("en", {});
  i18n.activate("en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const storage: RunErrorInfo = {
  code: "computer_storage_full",
  params: { agent: "QA", usedMb: "10035", totalMb: "10240", top: ".codex 475 MB" },
};
const raw = "Couldn't start the agent's computer.\nThe computer's storage is full.";

async function render(
  info: RunErrorInfo,
  handlers: Partial<Parameters<typeof RunErrorCard>[0]> = {},
  text = raw,
) {
  const all = {
    onRetry: vi.fn(),
    onFreeSpace: vi.fn().mockResolvedValue(undefined),
    onRecover: vi.fn().mockResolvedValue(undefined),
    onOpenUsage: vi.fn(),
    onAdjustLimit: vi.fn(),
    onResume: vi.fn(),
    onChangeModel: vi.fn(),
    onConnect: vi.fn(),
    ...handlers,
  };
  await act(async () => root.render(<RunErrorCard info={info} raw={text} {...all} />));
  return all;
}

const testIds = () =>
  [...container.querySelectorAll("button[data-testid]")]
    .map((button) => button.getAttribute("data-testid"))
    .filter((id) => id !== null);

async function click(testId: string) {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  await act(async () => button?.click());
}

describe("RunErrorCard", () => {
  it("shows a one-line title, one line of why and the storage actions", async () => {
    await render(storage);
    expect(container.querySelector("p")?.textContent).toBe("QA's computer is out of space");
    expect(container.textContent).toContain("Using 9.8 GB of 10 GB.");
    expect(testIds()).toEqual(["run-error-free-space", "run-error-recover"]);
  });

  it("collapses Details, and never repeats the title or the English raw text in them", async () => {
    await render(storage);
    const details = container.querySelector("details");
    expect(details?.open).toBe(false);
    const text = container.querySelector('[data-testid="run-error-details"]')?.textContent ?? "";
    expect(text).toBe("computer_storage_full");
    expect(text).not.toContain("out of space");
  });

  it("frees space, then offers to run the failed turn again", async () => {
    const handlers = await render(storage);
    await click("run-error-free-space");
    expect(handlers.onFreeSpace).toHaveBeenCalledOnce();
    expect(testIds()[0]).toBe("run-error-retry");
    expect(testIds()).not.toContain("run-error-free-space");
    await click("run-error-retry");
    expect(handlers.onRetry).toHaveBeenCalledOnce();
  });

  it("asks twice before recovering, then offers the retry", async () => {
    const handlers = await render(storage);
    await click("run-error-recover");
    expect(handlers.onRecover).not.toHaveBeenCalled();
    await click("run-error-recover");
    expect(handlers.onRecover).toHaveBeenCalledOnce();
    expect(testIds()).toContain("run-error-retry");
  });

  it("says why a clean-up failed and keeps the actions", async () => {
    await render(storage, {
      onFreeSpace: vi.fn().mockRejectedValue(new Error("Start the computer first.")),
    });
    await click("run-error-free-space");
    expect(container.textContent).toContain("Start the computer first.");
    expect(testIds()).toContain("run-error-free-space");
    expect(testIds()).not.toContain("run-error-retry");
  });

  it.each([
    [{ code: "computer_start_failed" }, ["run-error-retry", "run-error-recover"]],
    [{ code: "model_rate_limited" }, ["run-error-retry"]],
    [
      { code: "monthly_limit", params: { scope: "bot" } },
      ["run-error-adjust-limit", "run-error-open-usage"],
    ],
    [{ code: "paused", params: { scope: "space" } }, ["run-error-resume"]],
    [{ code: "no_model_access" }, ["run-error-connect"]],
    [{ code: "unknown" }, ["run-error-retry"]],
  ] as const)("shows the buttons of %j", async (info, ids) => {
    await render(info as RunErrorInfo);
    expect(testIds()).toEqual(ids);
  });

  it("leaves out an action the viewer cannot take", async () => {
    await render({ code: "paused", params: { scope: "space" } }, { onResume: undefined });
    expect(testIds()).toEqual([]);
  });

  it("uses the warning tone for a limit and the destructive tone for a failure", async () => {
    await render({ code: "monthly_limit", params: { scope: "bot" } });
    expect(container.querySelector("[role=alert]")?.className).toContain("border-warning");
    await render({ code: "unknown" });
    expect(container.querySelector("[role=alert]")?.className).toContain("border-destructive");
  });
});
