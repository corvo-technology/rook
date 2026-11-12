// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act, Suspense } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children?: ReactNode }) => children,
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings[0] }),
}));
vi.mock("@corvo/ui-web", () => ({
  SidePanel: ({
    open,
    onClose,
    title,
    closeLabel,
    footer,
    children,
  }: {
    open: boolean;
    onClose: () => void;
    title: ReactNode;
    closeLabel: string;
    footer?: ReactNode;
    children?: ReactNode;
  }) =>
    open ? (
      <aside>
        <h2>{title}</h2>
        <button type="button" onClick={onClose}>
          {closeLabel}
        </button>
        {children}
        {footer}
      </aside>
    ) : null,
  Button: ({ children, onClick }: ComponentProps<"button">) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

import { lazyOverlay } from "./ErrorBoundary";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // React reports every caught render error to the console.
  vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Integrations({ onClose: _onClose }: { onClose: () => void }) {
  return <h2>Integrations</h2>;
}

function button(name: string) {
  const match = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === name,
  );
  if (!match) throw new Error(`missing button ${name}`);
  return match;
}

async function renderInShell(overlay: ReactNode) {
  await act(async () => {
    root.render(
      <>
        <p>Composer draft</p>
        <Suspense fallback={null}>{overlay}</Suspense>
      </>,
    );
  });
}

it("renders the overlay once its chunk loads", async () => {
  const PluginsOverlay = lazyOverlay(async () => Integrations);

  await renderInShell(<PluginsOverlay onClose={vi.fn()} />);

  expect(container.textContent).toContain("Integrations");
  expect(container.textContent).not.toContain("Could not load");
});

it("keeps the shell when an overlay chunk fails to load", async () => {
  const PluginsOverlay = lazyOverlay(() =>
    Promise.reject(new TypeError("Failed to fetch dynamically imported module")),
  );

  await renderInShell(<PluginsOverlay onClose={vi.fn()} />);

  expect(container.textContent).toContain("Composer draft");
  expect(container.textContent).toContain("Could not load");
  expect(button("Refresh")).toBeTruthy();
});

it("closes an overlay that failed to load", async () => {
  const onClose = vi.fn();
  const PluginsOverlay = lazyOverlay(() => Promise.reject(new TypeError("Load failed")));

  await renderInShell(<PluginsOverlay onClose={onClose} />);
  await act(async () => button("Close").click());

  expect(onClose).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("Composer draft");
});

it("contains a render error thrown by a loaded overlay", async () => {
  function Broken(_props: { onClose: () => void }): ReactNode {
    throw new Error("render failed");
  }
  const SettingsOverlay = lazyOverlay(async () => Broken);

  await renderInShell(<SettingsOverlay onClose={vi.fn()} />);

  expect(container.textContent).toContain("Composer draft");
  expect(container.textContent).toContain("Could not load");
});
