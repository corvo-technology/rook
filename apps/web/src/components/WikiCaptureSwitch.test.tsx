// @vitest-environment jsdom
import type { WikiCaptureState } from "@corvo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const { get, set } = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../lib/space-rpc", () => ({
  useSpaceRpc: () => ({ wiki: { capture: { get, set } } }),
}));
vi.mock("@corvo/ui-web", () => ({
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
}));

import { WikiCaptureSwitch } from "./WikiCaptureSwitch";

const state = (patch: Partial<WikiCaptureState> = {}): WikiCaptureState => ({
  available: true,
  capture: null,
  on: true,
  canChange: true,
  ...patch,
});

let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.replaceChildren(host);
  get.mockReset();
  set.mockReset();
});

async function settle() {
  for (let i = 0; i < 6; i += 1)
    await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
}
async function mount() {
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <WikiCaptureSwitch target={{ groupId: "g1" }} />
      </QueryClientProvider>,
    ),
  );
  await settle();
}
const toggle = () => host.querySelector<HTMLElement>('[role="switch"]');

it("is hidden when the curator cannot read the conversation", async () => {
  get.mockResolvedValue(state({ available: false, on: false }));
  await mount();
  expect(toggle()).toBeNull();
});

it("is hidden when the state cannot be read", async () => {
  get.mockRejectedValue(new Error("down"));
  await mount();
  expect(toggle()).toBeNull();
});

it("shows the effective value, and sends an explicit boolean when turned off", async () => {
  get.mockResolvedValue(state());
  set.mockResolvedValue({ ok: true });
  await mount();
  expect(toggle()?.getAttribute("aria-checked")).toBe("true");
  expect(host.textContent).toContain("Learn from this conversation");
  await act(async () => toggle()?.click());
  await settle();
  expect(set).toHaveBeenCalledWith({ groupId: "g1", capture: false });
  expect(toggle()?.getAttribute("aria-checked")).toBe("false");
});

it("restores the previous value when the save fails", async () => {
  get.mockResolvedValue(state());
  set.mockRejectedValue(new Error("nope"));
  await mount();
  await act(async () => toggle()?.click());
  await settle();
  expect(toggle()?.getAttribute("aria-checked")).toBe("true");
});

it("is disabled for someone who does not own the conversation", async () => {
  get.mockResolvedValue(state({ canChange: false }));
  await mount();
  expect(toggle()?.hasAttribute("disabled")).toBe(true);
});
