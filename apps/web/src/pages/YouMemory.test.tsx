// @vitest-environment jsdom
import type { UserMemory } from "@corvo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { text } = vi.hoisted(() => ({
  text: (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((out, part, index) => out + part + (values[index] ?? ""), ""),
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: text }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@corvo/ui-web", () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    onCheckedChange: (value: boolean) => void;
  } & Omit<ComponentProps<"button">, "onChange">) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      {...props}
    />
  ),
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<"button"> & { variant?: string; size?: string }) => (
    <button type="button" {...props} />
  ),
  Input: (props: ComponentProps<"input">) => <input {...props} />,
}));

import { type YouApi, YouMemory } from "./YouMemory";

const memory = (id: string, textOf: string, extra: Partial<UserMemory> = {}): UserMemory => ({
  id,
  text: textOf,
  state: "saved",
  source: "typed",
  createdAt: "2026-11-01T00:00:00.000Z",
  stale: false,
  ...extra,
});

let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function show(initial: UserMemory[]) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let memories = initial;
  let learn = false;
  const api = {
    list: vi.fn(async () => memories),
    add: vi.fn(async ({ text: added }: { text: string }) => {
      const created = memory(`m${memories.length + 1}`, added);
      memories = [created, ...memories];
      return created;
    }),
    edit: vi.fn(async ({ memoryId, text: next }: { memoryId: string; text: string }) => {
      memories = memories.map((entry) =>
        entry.id === memoryId ? { ...entry, text: next } : entry,
      );
      return memories.find((entry) => entry.id === memoryId)!;
    }),
    decide: vi.fn(async ({ memoryId, decision }: { memoryId: string; decision: string }) => {
      const state = { save: "saved", discard: "forgotten", forget: "forgotten", keep: "saved" }[
        decision as "save"
      ];
      if (decision === "erase") {
        memories = memories.filter((entry) => entry.id !== memoryId);
        return null;
      }
      memories = memories.map((entry) =>
        entry.id === memoryId
          ? { ...entry, state: state as UserMemory["state"], stale: false }
          : entry,
      );
      return memories.find((entry) => entry.id === memoryId)!;
    }),
    settings: {
      get: vi.fn(async () => ({ learn })),
      set: vi.fn(async (patch: { learn?: boolean }) => {
        learn = patch.learn ?? learn;
        return { learn };
      }),
    },
  } satisfies YouApi;
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <YouMemory api={api} />
      </QueryClientProvider>,
    );
  });
  await flush();
  return { container, api };
}
/** Lets the queries and the answers they wait for settle. */
const flush = async () => {
  for (let tick = 0; tick < 3; tick += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
};
const click = (container: HTMLElement, label: string, within?: string) =>
  act(async () => {
    const scope = within ? container.querySelector(`[data-testid="${within}"]`)! : container;
    const found = [...scope.querySelectorAll("button")].find(
      (b) => b.textContent === label || b.getAttribute("aria-label") === label,
    );
    if (!found) throw new Error(`no button ${label}`);
    found.click();
  });

describe("YouMemory", () => {
  it("saves a typed fact when Enter is pressed", async () => {
    const { container, api } = await show([]);
    const input = container.querySelector("input")!;
    expect(input.getAttribute("aria-label")).toBe("Teach something about you");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "Prefers short answers",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(api.add).toHaveBeenCalledWith({ text: "Prefers short answers" });
    expect(container.textContent).toContain("Prefers short answers");
    expect(container.querySelector("input")!.value).toBe("");
  });

  it("holds suggestions for Save or Discard, apart from what is known", async () => {
    const { container, api } = await show([
      memory("a", "Runs a bakery", { state: "pending", source: "agent" }),
      memory("b", "Likes tea"),
    ]);
    expect(container.querySelector('[data-testid="you-new"]')!.textContent).toContain(
      "Runs a bakery",
    );
    expect(container.querySelector('[data-testid="you-list"]')!.textContent).toContain("Likes tea");
    await click(container, "Save", "you-new");
    expect(api.decide).toHaveBeenCalledWith({ memoryId: "a", decision: "save" });
    await flush();
    expect(container.querySelector('[data-testid="you-new"]')).toBeNull();
    expect(container.querySelector('[data-testid="you-list"]')!.textContent).toContain(
      "Runs a bakery",
    );
  });

  it("asks whether a fact not seen for a long time still holds, and keeps it until decided", async () => {
    const { container, api } = await show([memory("old", "Lives near the river", { stale: true })]);
    const stale = container.querySelector('[data-testid="you-stale"]')!;
    expect(stale.textContent).toContain("Still true?");
    expect(stale.textContent).toContain("Lives near the river");
    await click(container, "Keep", "you-stale");
    expect(api.decide).toHaveBeenCalledWith({ memoryId: "old", decision: "keep" });
    await flush();
    expect(container.querySelector('[data-testid="you-stale"]')).toBeNull();
    expect(container.querySelector('[data-testid="you-list"]')!.textContent).toContain(
      "Lives near the river",
    );
  });

  it("forgets a fact, lists it as forgotten, and erases it only on request", async () => {
    const { container, api } = await show([memory("b", "Likes tea")]);
    await click(container, "Forget", "you-list");
    await flush();
    const forgotten = container.querySelector('[data-testid="you-forgotten"]')!;
    expect(forgotten.textContent).toContain("Likes tea");
    expect(container.querySelector('[data-testid="you-list"]')).toBeNull();
    await click(container, "Delete for good", "you-forgotten");
    expect(api.decide).toHaveBeenLastCalledWith({ memoryId: "b", decision: "erase" });
    await flush();
    expect(container.querySelector('[data-testid="you-forgotten"]')).toBeNull();
  });

  it("edits a fact in place", async () => {
    const { container, api } = await show([memory("b", "Likes tea")]);
    await click(container, "Edit", "you-list");
    const input = container.querySelector('[data-testid="you-list"] input') as HTMLInputElement;
    expect(input.value).toBe("Likes tea");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "Likes green tea",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input
        .closest("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(api.edit).toHaveBeenCalledWith({ memoryId: "b", text: "Likes green tea" });
    expect(container.querySelector('[data-testid="you-list"]')!.textContent).toContain(
      "Likes green tea",
    );
  });

  it("turns on suggesting from what the person says", async () => {
    const { container, api } = await show([]);
    const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => toggle.click());
    expect(api.settings.set).toHaveBeenCalledWith({ learn: true });
  });
});
