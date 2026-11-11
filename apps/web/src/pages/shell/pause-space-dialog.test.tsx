// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => text + part + (values[index] ?? ""), "");
  return {
    useLingui: () => ({ t, i18n: { locale: "en" } }),
    Trans: ({ children }: { children: ReactNode }) => children,
    Plural: () => null,
  };
});

import { PauseSpaceDialog } from "./dialogs";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function renderDialog(onConfirm: () => Promise<void>, onCancel = vi.fn()) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(<PauseSpaceDialog onCancel={onCancel} onConfirm={onConfirm} />),
  );
  const button = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent === label,
    );
  return { root, button, onCancel };
}

describe("PauseSpaceDialog", () => {
  it("asks once, with the confirmation sentence, and confirms once on a double click", async () => {
    let finish: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { root, button } = await renderDialog(onConfirm);
    expect(document.body.textContent).toContain(
      "Running work stops and nothing starts until you resume.",
    );
    const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")].filter(
      (candidate) => candidate.textContent === "Pause all bots",
    );
    await act(async () => {
      confirm[0]?.click();
      confirm[0]?.click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(button("Cancel")?.disabled).toBe(true);
    finish();
    await act(async () => root.unmount());
  });

  it("calls nothing when cancelled", async () => {
    const onConfirm = vi.fn(async () => undefined);
    const { root, button, onCancel } = await renderDialog(onConfirm);
    await act(async () => button("Cancel")?.click());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("shows the error and stays open when pausing fails", async () => {
    const onConfirm = vi.fn(async () => {
      throw new Error("Network down");
    });
    const { root } = await renderDialog(onConfirm);
    const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent === "Pause all bots",
    );
    await act(async () => confirm?.click());
    expect(document.body.textContent).toContain("Network down");
    expect(confirm?.disabled).toBe(false);
    await act(async () => root.unmount());
  });
});
