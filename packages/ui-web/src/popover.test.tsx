// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Popover, PopoverContent } from "./components/ui/popover.js";

it("opens anchored to an element outside any trigger", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const anchor = document.createElement("div");
  const host = document.createElement("div");
  document.body.append(anchor, host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <Popover open>
        <PopoverContent anchor={anchor}>Hi</PopoverContent>
      </Popover>,
    );
  });
  expect(document.body.textContent).toContain("Hi");
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
