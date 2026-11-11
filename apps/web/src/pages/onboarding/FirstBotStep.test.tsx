// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ensureFirstBot = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => ({
  autoReview: { get: vi.fn() },
  bots: { get: vi.fn(), update: vi.fn() },
}));
vi.mock("../../lib/first-bot", () => ({ ensureFirstBot }));
vi.mock("../../lib/rpc", () => ({ rpc }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@corvo/ui-web", async () => ({
  ...(await import("../../test-support/ui-web-choice-doubles")).choiceDoubles,
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<"button"> & { variant?: string; size?: string }) => (
    <button type="button" {...props} />
  ),
}));

import { FirstBotStep } from "./FirstBotStep";

const onReady = vi.fn();
let container: HTMLDivElement;
let root: Root;

const settings = (mode: "ask" | "auto" | "never") => ({
  mode,
  enabled: mode === "auto",
  skipApprovals: mode === "never",
  checkerAvailable: true,
});
const radios = () => [...container.querySelectorAll<HTMLElement>('[role="radio"]')];
const radio = (mode: string) => radios().find((node) => node.dataset.value === mode)!;
const checked = () => radios().find((node) => node.getAttribute("aria-checked") === "true");
const button = (text: string) =>
  [...container.querySelectorAll("button")].find((node) => node.textContent === text)!;

async function mount() {
  await act(async () => {
    root.render(<FirstBotStep locale="pt-BR" onReady={onReady} />);
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ensureFirstBot.mockReset().mockResolvedValue({ id: "chief-1" });
  rpc.autoReview.get.mockReset().mockResolvedValue(settings("auto"));
  rpc.bots.get.mockReset().mockResolvedValue({ id: "chief-1", name: "Ana" });
  rpc.bots.update.mockReset().mockResolvedValue({});
  onReady.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("FirstBotStep", () => {
  it("makes sure the Chief exists, in the app's language, and asks how much it does on its own", async () => {
    await mount();
    expect(ensureFirstBot).toHaveBeenCalledOnce();
    expect(ensureFirstBot).toHaveBeenCalledWith("pt-BR");
    expect(container.textContent).toContain("How much does Ana do on its own?");
    expect(checked()?.dataset.value).toBe("auto");
    expect(onReady).not.toHaveBeenCalled();
  });

  it("moves on with the default and saves nothing when Continue is pressed untouched", async () => {
    await mount();
    await act(async () => button("Continue").click());
    expect(rpc.bots.update).not.toHaveBeenCalled();
    expect(onReady).toHaveBeenCalledExactlyOnceWith("chief-1");
  });

  it("saves the chosen answer once, even on a double click, before moving on", async () => {
    let finish: () => void = () => undefined;
    rpc.bots.update.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await mount();
    await act(async () => radio("ask").click());
    const next = button("Continue");
    await act(async () => {
      next.click();
      next.click();
    });
    expect(rpc.bots.update).toHaveBeenCalledExactlyOnceWith({
      botId: "chief-1",
      approvalMode: "ask",
    });
    expect(onReady).not.toHaveBeenCalled();
    expect(next.disabled).toBe(true);
    await act(async () => finish());
    expect(onReady).toHaveBeenCalledExactlyOnceWith("chief-1");
  });

  it("leaves the default checked when free is cancelled", async () => {
    await mount();
    await act(async () => radio("never").click());
    await act(async () => button("Cancel").click());
    expect(checked()?.dataset.value).toBe("auto");
    await act(async () => button("Continue").click());
    expect(rpc.bots.update).not.toHaveBeenCalled();
  });

  it("moves on with no question when the default cannot be read", async () => {
    rpc.autoReview.get.mockRejectedValue(new Error("offline"));
    await mount();
    expect(onReady).toHaveBeenCalledExactlyOnceWith("chief-1");
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
  });

  it("does not move on when the answer cannot be saved, and tries it again", async () => {
    rpc.bots.update.mockRejectedValueOnce(new Error("offline"));
    await mount();
    await act(async () => radio("ask").click());
    await act(async () => button("Continue").click());
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(onReady).not.toHaveBeenCalled();
    await act(async () => button("Try again").click());
    expect(rpc.bots.update).toHaveBeenCalledTimes(2);
    expect(onReady).toHaveBeenCalledExactlyOnceWith("chief-1");
  });

  it("does not move on without the Chief, and retries making it", async () => {
    ensureFirstBot.mockRejectedValueOnce(new Error("offline"));
    await mount();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(onReady).not.toHaveBeenCalled();
    await act(async () => button("Try again").click());
    expect(ensureFirstBot).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("How much does Ana do on its own?");
  });
});
