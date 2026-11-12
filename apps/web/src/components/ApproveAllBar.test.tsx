// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) => String.raw(parts, ...values),
  }),
}));

import { ApproveAllBar } from "./ApproveAllBar";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const items = [
  { messageId: "m1", runId: "r1", approvalEffectId: "e1" },
  { messageId: "m2", runId: "r2", approvalEffectId: "e2" },
];
const batches = [{ batchClass: "tool" as const, items }];

async function render(
  onApproveAll: ComponentProps<typeof ApproveAllBar>["onApproveAll"],
  props: { batches?: typeof batches; pending?: string[] } = {},
) {
  await act(async () =>
    root.render(
      <ApproveAllBar
        batches={props.batches ?? batches}
        pendingEffectIds={new Set(props.pending ?? ["e1", "e2"])}
        onApproveAll={onApproveAll}
      />,
    ),
  );
}

const button = () => container.querySelector("button");

it("renders nothing without a batch", async () => {
  await render(vi.fn(), { batches: [] });
  expect(container.textContent).toBe("");
});

it("names how many it approves and sends the class with its items", async () => {
  const onApproveAll = vi.fn().mockResolvedValue([]);
  await render(onApproveAll);
  expect(button()?.textContent).toBe("Approve all 2");
  await act(async () => button()?.click());
  expect(onApproveAll).toHaveBeenCalledWith("tool", items);
  expect(container.textContent).not.toContain("could not");
});

it("counts the approvals that were not decided while they still wait", async () => {
  await render(vi.fn().mockResolvedValue(["e2"]), { pending: ["e2"] });
  await act(async () => button()?.click());
  expect(container.textContent).toContain("1 could not be approved");
  await render(vi.fn().mockResolvedValue(["e2"]), { batches: [], pending: [] });
  expect(container.textContent).toBe("");
});

it("shows the error when the whole request fails and keeps the cards", async () => {
  await render(vi.fn().mockRejectedValue(new Error("offline")));
  await act(async () => button()?.click());
  expect(container.textContent).toContain("offline");
  expect(button()?.disabled).toBe(false);
});
