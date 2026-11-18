// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saveBusiness = vi.hoisted(() => vi.fn());
vi.mock("../../lib/rpc", () => ({ rpc: { onboarding: { saveBusiness } } }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return {
    useLingui: () => ({ t, i18n: { locale: "pt-BR" } }),
    Trans: ({ children }: { children: ReactNode }) => children,
  };
});

import { BusinessStep } from "./BusinessStep";

const onDone = vi.fn();
let container: HTMLDivElement;
let root: Root;

const button = (name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith(name))!;

async function submit() {
  await act(async () => {
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function type(value: string) {
  const input = container.querySelector("input") as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  saveBusiness.mockReset().mockResolvedValue({ ok: true });
  onDone.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<BusinessStep initial={null} onDone={onDone} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("BusinessStep", () => {
  it("offers every kind of business as a choice", () => {
    for (const label of [
      "Agency",
      "Online store",
      "Clinic or practice",
      "Software and apps",
      "Customer service",
      "Services office",
      "Something else",
    ]) {
      expect(button(label), label).toBeTruthy();
    }
  });

  it("saves the kind and the sentence as the workspace's knowledge", async () => {
    act(() => button("Agency").click());
    type("  We run ads for dentists ");
    await submit();
    expect(saveBusiness).toHaveBeenCalledWith({
      kind: "agency",
      summary: "We run ads for dentists",
      locale: "pt-BR",
    });
    expect(onDone).toHaveBeenCalledWith({ kind: "agency", summary: "We run ads for dentists" });
  });

  it("counts a sentence alone as something else", async () => {
    type("Beekeeping");
    await submit();
    expect(saveBusiness).toHaveBeenCalledWith({
      kind: "other",
      summary: "Beekeeping",
      locale: "pt-BR",
    });
  });

  it("says nothing and saves nothing when nothing was answered", async () => {
    await submit();
    expect(saveBusiness).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith(null);
  });

  it("stays on the step when saving fails", async () => {
    saveBusiness.mockRejectedValueOnce(new Error("down"));
    act(() => button("Clinic or practice").click());
    await submit();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });
});
