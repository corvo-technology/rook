// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signupSurvey = vi.hoisted(() => vi.fn());
vi.mock("../../lib/rpc", () => ({ rpc: { onboarding: { signupSurvey } } }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

import { UseStep } from "./UseStep";

const onDone = vi.fn();
let container: HTMLDivElement;
let root: Root;

function button(name: string) {
  const found = [...container.querySelectorAll("button")].find((b) => b.textContent === name);
  if (!found) throw new Error(`no button ${name}`);
  return found;
}

async function click(name: string) {
  await act(async () => button(name).click());
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  signupSurvey.mockReset().mockResolvedValue({ ok: true });
  onDone.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<UseStep onDone={onDone} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("UseStep", () => {
  it("hands on the use answer and the categories in the order tapped", async () => {
    await click("Support");
    await click("Sales");
    await click("Work");
    await click("Continue");
    expect(onDone).toHaveBeenCalledWith({ use: "work", categories: ["support", "sales"] });
  });

  it("saves how the person will use Rook", async () => {
    await click("Work");
    await click("Continue");
    expect(signupSurvey).toHaveBeenCalledWith({ use: "work" });
  });

  it("continues with nothing picked and leaves saved answers alone", async () => {
    await click("Continue");
    expect(signupSurvey).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith({ categories: [] });
  });

  it("does not wait for or fail on a survey that cannot be saved", async () => {
    signupSurvey.mockRejectedValue(new Error("down"));
    await click("Work");
    await click("Continue");
    expect(onDone).toHaveBeenCalledWith({ use: "work", categories: [] });
  });

  it("exposes which categories are picked", async () => {
    expect(button("Sales").getAttribute("aria-pressed")).toBe("false");
    await click("Sales");
    expect(button("Sales").getAttribute("aria-pressed")).toBe("true");
    await click("Sales");
    expect(button("Sales").getAttribute("aria-pressed")).toBe("false");
  });
});
