// @vitest-environment jsdom

import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) => String.raw(parts, ...values),
  }),
}));

import { resetHostForTests, setHostContext } from "../../lib/embed-host";
import { HostContextChip } from "./host-context-chip";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetHostForTests();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("shows nothing until the page says what the person is looking at", async () => {
  await act(async () => root.render(<HostContextChip />));
  expect(container.querySelector("[data-testid=host-context-chip]")).toBeNull();
});

it("shows the first entity, and follows the page as it changes", async () => {
  await act(async () => root.render(<HostContextChip />));
  await act(async () =>
    setHostContext({
      page: "/clientes/42",
      entities: [{ type: "customer", id: "42", label: "Carlos Souza" }],
    }),
  );
  expect(container.textContent).toBe("Viewing: Carlos Souza");
  await act(async () => setHostContext({ title: "Agenda", entities: [] }));
  expect(container.textContent).toBe("Viewing: Agenda");
  await act(async () => setHostContext(null));
  expect(container.querySelector("[data-testid=host-context-chip]")).toBeNull();
});
