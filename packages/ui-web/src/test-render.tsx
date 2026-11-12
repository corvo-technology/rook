import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";

/** Mounts a tree in jsdom for the block tests. */
export async function mount(node: ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    host,
    rerender: (next: ReactNode) => act(async () => root.render(next)),
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

export function key(target: EventTarget, name: string) {
  return act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    );
  });
}
