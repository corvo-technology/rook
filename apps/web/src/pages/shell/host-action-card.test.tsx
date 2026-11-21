// @vitest-environment jsdom

import type { ReactNode } from "react";
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
const resolveHostAction = vi.hoisted(() => vi.fn(async (_input: unknown) => ({ ok: true })));
vi.mock("../../lib/rpc", () => ({ rpc: { threads: { resolveHostAction } } }));

import { answerHostAction, hostState, onHostAsk, resetHostForTests } from "../../lib/embed-host";
import { HostActionCard } from "./host-action-card";

type Block = Parameters<typeof HostActionCard>[0]["block"];

let root: Root;
let container: HTMLDivElement;
const parentPost = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetHostForTests();
  resolveHostAction.mockClear();
  parentPost.mockClear();
  // The card runs in the partner's frame, so its parent is the partner's page.
  vi.spyOn(window, "parent", "get").mockReturnValue({ postMessage: parentPost } as never);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const block = (status: Block["status"] = "pending"): Block => ({
  kind: "host_action",
  actionId: "a1",
  name: "open_agenda",
  label: "Abrir na agenda",
  params: { day: "2026-11-19" },
  status,
});

async function render(value: Block) {
  await act(async () =>
    root.render(<HostActionCard botId="bot-1" messageId="m-1" block={value} />),
  );
}

const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  ) as HTMLButtonElement;

it("shows the proposed action and does nothing until the person confirms", async () => {
  await render(block());
  expect(container.textContent).toContain("Abrir na agenda");
  expect(parentPost).not.toHaveBeenCalled();
  expect(resolveHostAction).not.toHaveBeenCalled();
});

it("hands the action to the page only after Confirm, then records how it went", async () => {
  const asked = vi.fn();
  onHostAsk(asked);
  await render(block());
  await act(async () => button("Confirm").click());
  expect(parentPost).toHaveBeenCalledWith(
    { type: "corvo:action", id: "a1", name: "open_agenda", params: { day: "2026-11-19" } },
    "*",
  );
  expect(resolveHostAction).not.toHaveBeenCalled();
  await act(async () => answerHostAction("a1", { ok: true, result: "Opened" }));
  expect(resolveHostAction).toHaveBeenCalledWith({
    botId: "bot-1",
    messageId: "m-1",
    actionId: "a1",
    actionName: "open_agenda",
    outcome: "done",
  });
  expect(hostState().results).toEqual([{ name: "open_agenda", outcome: "done", result: "Opened" }]);
  // The agent hears exactly what the page reported, and it is a system line, not the person's words.
  expect(asked).toHaveBeenCalledWith(
    expect.stringContaining('The page carried out "Abrir na agenda" and reported: Opened.'),
    { hostResult: { outcome: "done" } },
  );
  expect(asked.mock.calls[0]?.[0]).not.toBe("Done");
});

it("tells the agent that nothing was created when the page reports no more than opening a screen", async () => {
  const asked = vi.fn();
  onHostAsk(asked);
  await render(block());
  await act(async () => button("Confirm").click());
  await act(async () => answerHostAction("a1", { ok: true }));
  const text = String(asked.mock.calls[0]?.[0]);
  expect(text).toContain("nothing was scheduled, sent, created or changed");
  expect(asked.mock.calls[0]?.[1]).toEqual({ hostResult: { outcome: "done" } });
});

it("records a failure the page reports", async () => {
  const asked = vi.fn();
  onHostAsk(asked);
  await render(block());
  await act(async () => button("Confirm").click());
  await act(async () => answerHostAction("a1", { ok: false, result: "No slot" }));
  expect(resolveHostAction).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed" }));
  expect(asked).toHaveBeenCalledWith(
    expect.stringContaining(
      'The page could not carry out "Abrir na agenda": No slot. Nothing was done.',
    ),
    { hostResult: { outcome: "failed" } },
  );
});

it("never reaches the page when the person says Not now", async () => {
  await render(block());
  await act(async () => button("Not now").click());
  expect(parentPost).not.toHaveBeenCalled();
  expect(resolveHostAction).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied" }));
  expect(hostState().results[0]?.outcome).toBe("denied");
});

it("shows a decided card without buttons", async () => {
  await render(block("done"));
  expect(container.querySelectorAll("button")).toHaveLength(0);
  expect(container.textContent).toContain("Done");
  await render(block("failed"));
  expect(container.textContent).toContain("That didn't work");
});
