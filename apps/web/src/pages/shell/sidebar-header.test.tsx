// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarHeader, useCreateMenu } from "./sidebar-header";

// The header's copy is not under test.
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

function Probe() {
  const [open, setOpen] = useCreateMenu();
  return (
    <button type="button" onClick={() => setOpen(false)}>
      {open ? "open" : "closed"}
    </button>
  );
}

it("keeps Cmd/Ctrl-N pressed before the sidebar shows, so the menu opens with it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Probe />));
    expect(host.textContent).toBe("closed");
    const press = new KeyboardEvent("keydown", { key: "n", ctrlKey: true, cancelable: true });
    await act(async () => window.dispatchEvent(press));
    expect(press.defaultPrevented).toBe(true);
    expect(host.textContent).toBe("open");
    await act(async () => host.querySelector("button")!.click());
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "n", ctrlKey: true, shiftKey: true }),
      ),
    );
    expect(host.textContent).toBe("closed");
  } finally {
    await act(async () => root.unmount());
  }
});

describe("the paused label", () => {
  async function renderHeader(props: { paused?: boolean; onResume?: () => void }) {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <SidebarHeader
          createMenuOpen={false}
          setCreateMenuOpen={() => {}}
          activityMode={false}
          toggleActivityMode={() => {}}
          setBotsSidebarCollapsedPref={() => {}}
          bots={[]}
          setMobileSidebarOpen={() => {}}
          setPanel={() => {}}
          navigate={() => {}}
          setNewSpaceOpen={() => {}}
          setCreateBotOpen={() => {}}
          {...props}
        />,
      ),
    );
    return { host, root };
  }

  it("shows nothing for a space that is running", async () => {
    const { host, root } = await renderHeader({});
    expect(host.textContent).not.toContain("Paused");
    await act(async () => root.unmount());
  });

  it("shows Paused with Resume for an owner", async () => {
    const onResume = vi.fn();
    const { host, root } = await renderHeader({ paused: true, onResume });
    expect(host.textContent).toContain("Paused");
    const resume = [...host.querySelectorAll("button")].find((b) => b.textContent === "Resume");
    await act(async () => resume?.click());
    expect(onResume).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

  it("shows Paused without a button for a member", async () => {
    const { host, root } = await renderHeader({ paused: true });
    expect(host.textContent).toContain("Paused");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Resume")).toBe(
      false,
    );
    await act(async () => root.unmount());
  });
});
