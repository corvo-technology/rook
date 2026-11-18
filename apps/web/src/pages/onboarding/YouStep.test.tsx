// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saveAreas = vi.hoisted(() => vi.fn());
const updateUser = vi.hoisted(() => vi.fn());
vi.mock("../../lib/rpc", () => ({ rpc: { onboarding: { saveAreas } } }));
vi.mock("../../lib/auth", () => ({ authClient: { updateUser } }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

import { YouStep } from "./YouStep";

const onDone = vi.fn();
let container: HTMLDivElement;
let root: Root;

const chip = (name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === name)!;

async function submit() {
  await act(async () => {
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function typeName(value: string) {
  const input = container.querySelector("input:not([type=file])") as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  saveAreas.mockReset().mockResolvedValue({ ok: true });
  updateUser.mockReset().mockResolvedValue({ data: {} });
  onDone.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <YouStep initialName="Pedro" initialImage={null} initialAreas={[]} onDone={onDone} />,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("YouStep", () => {
  it("shows initials until there is a photo", () => {
    expect(container.textContent).toContain("PE");
  });

  it("stores what the person looks after on the member and leaves the name alone when unchanged", async () => {
    act(() => chip("Marketing").click());
    act(() => chip("Sales").click());
    await submit();
    expect(updateUser).not.toHaveBeenCalled();
    expect(saveAreas).toHaveBeenCalledWith({ areas: ["marketing", "sales"] });
    expect(onDone).toHaveBeenCalledWith({
      name: "Pedro",
      image: null,
      areas: ["marketing", "sales"],
    });
  });

  it("takes an area off when tapped again", async () => {
    act(() => chip("Finance").click());
    act(() => chip("Finance").click());
    await submit();
    expect(saveAreas).toHaveBeenCalledWith({ areas: [] });
  });

  it("saves a changed name", async () => {
    typeName("  Pedro Alves ");
    await submit();
    expect(updateUser).toHaveBeenCalledWith({ name: "Pedro Alves" });
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ name: "Pedro Alves" }));
  });

  it("needs a name", async () => {
    typeName("   ");
    await submit();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(saveAreas).not.toHaveBeenCalled();
  });

  it("stays on the step when the name cannot be saved", async () => {
    updateUser.mockResolvedValueOnce({ error: { message: "no" } });
    typeName("Ana");
    await submit();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });
});
