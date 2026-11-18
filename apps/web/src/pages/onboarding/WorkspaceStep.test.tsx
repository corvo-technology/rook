// @vitest-environment jsdom

import { SPACE_NAME_MAX_LENGTH } from "@corvo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rename = vi.hoisted(() => vi.fn());
const updatePreferences = vi.hoisted(() => vi.fn());
/** What the person's language calls things; empty means English, which has no translation to apply. */
const translated = vi.hoisted(() => ({ text: {} as Record<string, string> }));
vi.mock("../../lib/rpc", () => ({
  rpc: { spaces: { rename }, preferences: { update: updatePreferences } },
}));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) => {
    const text = parts.reduce(
      (joined, part, index) => `${joined}${index > 0 ? values[index - 1] : ""}${part}`,
      "",
    );
    return translated.text[text] ?? text;
  };
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

import { WorkspaceStep } from "./WorkspaceStep";

const onDone = vi.fn();
let container: HTMLDivElement;
let root: Root;

function type(value: string) {
  const input = container.querySelector("input:not([type=file])") as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  const form = container.querySelector("form") as HTMLFormElement;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  updatePreferences.mockReset().mockResolvedValue({});
  rename.mockReset().mockImplementation(async ({ name }: { name: string }) => ({ id: "s1", name }));
  onDone.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <WorkspaceStep
        spaceId="s1"
        initialName="Personal"
        timezone="America/Sao_Paulo"
        onDone={onDone}
      />,
    ),
  );
});

afterEach(() => {
  translated.text = {};
  act(() => root.unmount());
  container.remove();
});

describe("WorkspaceStep", () => {
  it("moves on without renaming when the name is unchanged", async () => {
    await submit();
    expect(rename).not.toHaveBeenCalled();
    expect(updatePreferences).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith({ name: "Personal", logo: null });
  });

  it("shows an error and saves nothing for a blank or too long name", async () => {
    for (const value of ["   ", "x".repeat(SPACE_NAME_MAX_LENGTH + 1)]) {
      type(value);
      await submit();
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
    }
    expect(rename).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("renames the space once and passes the saved name on", async () => {
    type("  Alves Studio ");
    await submit();
    await submit();
    expect(rename).toHaveBeenCalledWith({ spaceId: "s1", name: "Alves Studio" });
    expect(onDone).toHaveBeenCalledWith({ name: "Alves Studio", logo: null });
  });

  it("saves a timezone the person changed", async () => {
    const select = container.querySelector("select") as HTMLSelectElement;
    act(() => {
      select.value = "UTC";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await submit();
    expect(updatePreferences).toHaveBeenCalledWith({ timezone: "UTC" });
  });

  it("stays on the step when the rename fails", async () => {
    rename.mockRejectedValueOnce(new Error("down"));
    type("Alves Studio");
    await submit();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("shows the starting name of a new space in the person's language", async () => {
    translated.text = { Personal: "Pessoal" };
    act(() =>
      root.render(
        <WorkspaceStep
          key="pt"
          spaceId="s1"
          initialName="Personal"
          timezone="America/Sao_Paulo"
          onDone={onDone}
        />,
      ),
    );
    expect((container.querySelector("input:not([type=file])") as HTMLInputElement).value).toBe(
      "Pessoal",
    );
    await submit();
    expect(rename).toHaveBeenCalledWith({ spaceId: "s1", name: "Pessoal" });
  });

  it("leaves a name the person already chose alone", () => {
    translated.text = { Personal: "Pessoal" };
    act(() =>
      root.render(
        <WorkspaceStep
          key="named"
          spaceId="s1"
          initialName="Alves Studio"
          timezone="America/Sao_Paulo"
          onDone={onDone}
        />,
      ),
    );
    expect((container.querySelector("input:not([type=file])") as HTMLInputElement).value).toBe(
      "Alves Studio",
    );
  });
});
