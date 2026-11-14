// @vitest-environment jsdom
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { createSpaceRpc } from "../../lib/rpc";
import { useSpaceRoster } from "./use-space-roster";

const gone = vi.hoisted(() => ({ listeners: new Set<(t: { botId?: string }) => void>() }));
vi.mock("../../lib/rpc", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../../lib/rpc")),
  onRpcTargetGone: (listener: (t: { botId?: string }) => void) => {
    gone.listeners.add(listener);
    return () => gone.listeners.delete(listener);
  },
}));

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
}));

let root: Root;
afterEach(() => act(() => root.unmount()));

describe("a view whose bot was deleted", () => {
  it("reloads the roster once and leaves the dead route", async () => {
    const live = { id: "bot-live", name: "Live" };
    const list = vi.fn(async () => ({
      current: { bots: [live], botSections: [], groups: [] },
      spaces: [],
    }));
    const rpc = { spaces: { list } } as unknown as ReturnType<typeof createSpaceRpc>;
    const redirect = vi.fn();
    function Probe() {
      useSpaceRoster({
        rpc,
        seed: undefined,
        botId: "bot-dead",
        groupId: undefined,
        navigate: vi.fn(),
        redirectKeepingOverlay: redirect,
      } as never);
      return null;
    }
    root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    await act(async () => {
      for (const listener of gone.listeners) listener({ botId: "bot-other" });
    });
    expect(list).not.toHaveBeenCalled();
    await act(async () => {
      for (const listener of gone.listeners) listener({ botId: "bot-dead" });
      for (const listener of gone.listeners) listener({ botId: "bot-dead" });
    });
    expect(list).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/app/bot-live");
  });
});
