// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const exportSpace = vi.fn();
vi.mock("../lib/space-rpc", () => ({
  useSpaceRpc: () => ({ export: { space: exportSpace } }),
}));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@corvo/ui-web", () => ({
  Spinner: (props: ComponentProps<"svg">) => <svg {...props} />,
  Button: (props: ComponentProps<"button">) => <button type="button" {...props} />,
}));
vi.mock("./ImportFromApp", () => ({ ImportFromApp: () => <button type="button">Import</button> }));

import { SpaceTransfer } from "./SpaceTransfer";

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  exportSpace.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<SpaceTransfer spaceName="Acme" />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("SpaceTransfer", () => {
  it("exports the space and leaves every import to the one import flow", async () => {
    exportSpace.mockResolvedValue({ kind: "space" });
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Export space",
      "Import",
    ]);
    await act(async () => host.querySelector("button")?.click());
    expect(exportSpace).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Space exported.");
  });
});
