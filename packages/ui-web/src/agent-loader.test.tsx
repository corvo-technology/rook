// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dom = vi.hoisted(() => {
  const handles: { update: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[] = [];
  const mountAvatar = vi.fn(() => {
    const handle = { update: vi.fn(), destroy: vi.fn() };
    handles.push(handle);
    return handle;
  });
  return { mountAvatar, handles };
});
vi.mock("open-bot-avatar/dom", () => ({ mountAvatar: dom.mountAvatar }));

import { AGENT_LOADER_WORKING_AFTER_MS, AgentLoader } from "./agent-loader.js";
import { SpinnerLabelProvider } from "./components/ui/spinner.js";

beforeEach(() => {
  vi.useFakeTimers();
  dom.mountAvatar.mockClear();
  dom.handles.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => vi.useRealTimers());

async function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, unmount: () => act(async () => root.unmount()) };
}

const lastState = () =>
  (dom.mountAvatar.mock.calls.at(-1) as unknown as [HTMLElement, { state?: string }])[1].state;
const updates = () => dom.handles.flatMap((h) => h.update.mock.calls.map((c) => c[0]));

describe("AgentLoader", () => {
  it("thinks at first, then works once the wait passes the threshold", async () => {
    const { host } = await render(<AgentLoader />);
    const loader = host.querySelector("[data-slot=agent-loader]");
    expect(loader?.getAttribute("data-status")).toBe("queued");
    expect(lastState()).toBe("thinking");

    await act(async () => vi.advanceTimersByTime(AGENT_LOADER_WORKING_AFTER_MS - 1));
    expect(loader?.getAttribute("data-status")).toBe("queued");

    await act(async () => vi.advanceTimersByTime(1));
    expect(loader?.getAttribute("data-status")).toBe("running");
    expect(updates().some((u) => (u as { state?: string }).state === "working")).toBe(true);
  });

  it("is one status with the kit's loading label, or its own", async () => {
    const { host } = await render(
      <SpinnerLabelProvider label="Carregando…">
        <AgentLoader />
        <AgentLoader label="Loading activity…" />
      </SpinnerLabelProvider>,
    );
    const statuses = [...host.querySelectorAll("[role=status]")];
    expect(statuses.map((s) => s.getAttribute("aria-label"))).toEqual([
      "Carregando…",
      "Loading activity…",
    ]);
  });

  it("stops its timer when it goes away before the threshold", async () => {
    const { host, unmount } = await render(<AgentLoader />);
    await unmount();
    await act(async () => vi.advanceTimersByTime(AGENT_LOADER_WORKING_AFTER_MS * 2));
    expect(host.querySelector("[data-slot=agent-loader]")).toBeNull();
  });
});
