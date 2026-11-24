// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: unknown }) => children,
}));
vi.mock("@corvo/ui-web", () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
  Button: (props: React.ComponentProps<"button">) => <button type="button" {...props} />,
}));

import { WikiChangeCard, type WikiChangeCardProps } from "./WikiChangeCard";

const change: WikiChangeCardProps["change"] = {
  state: "pending",
  reason: "A contractor was chosen",
  sourceTitle: "Lobby renovation",
  pages: [
    { title: "Alpha Builders", op: "create" },
    { title: "Plan", op: "replace" },
  ],
  edits: [
    { title: "Alpha Builders", op: "create" as const, added: "Chosen for the lobby." },
    { title: "Plan", op: "replace" as const, removed: "Start Nov 18.", added: "Start Nov 25." },
  ],
  canSeeSource: true,
  sourceText: "Ana: we are going with Alpha Builders.",
};

let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function show(props: Partial<WikiChangeCardProps> = {}) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const onDecide = vi.fn();
  const onOpenPage = vi.fn();
  await act(async () => {
    root!.render(
      <WikiChangeCard change={change} onDecide={onDecide} onOpenPage={onOpenPage} {...props} />,
    );
  });
  const buttons = () => [...container.querySelectorAll("button")].map((b) => b.textContent);
  const click = async (label: string) => {
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === label);
    await act(async () => button!.click());
  };
  return { container, buttons, click, onDecide, onOpenPage };
}

describe("a card for what the wiki kept", () => {
  it("offers to try a conflict again only while it can be", async () => {
    const onRetry = vi.fn();
    const first = await show({ change: { ...change, state: "conflict", canRetry: true }, onRetry });
    await first.click("Try again");
    expect(onRetry).toHaveBeenCalledTimes(1);
    await act(async () => root?.unmount());
    document.body.innerHTML = "";
    const spent = await show({
      change: { ...change, state: "conflict", canRetry: false },
      onRetry,
    });
    expect(spent.buttons()).not.toContain("Try again");
  });

  it("names each page and, while it waits, offers to approve or refuse", async () => {
    const { container, buttons, click, onDecide } = await show();
    expect(container.querySelector('[data-testid="wiki-change"]')?.getAttribute("data-state")).toBe(
      "pending",
    );
    expect(container.textContent).toContain("Waiting for approval");
    expect(container.textContent).toContain("Alpha Builders");
    expect(container.textContent).toContain("Plan");
    expect(buttons()).toEqual(expect.arrayContaining(["Approve", "Refuse"]));
    expect(buttons()).not.toContain("Undo");
    await click("Approve");
    expect(onDecide).toHaveBeenCalledWith("apply");
    await click("Refuse");
    expect(onDecide).toHaveBeenCalledWith("refuse");
  });

  it("shows what would be written, the old words and the new, before anyone approves it", async () => {
    const { container } = await show();
    const edits = container.querySelector('[data-testid="wiki-change-edits"]');
    expect(edits?.textContent).toContain("Chosen for the lobby.");
    expect(edits?.textContent).toContain("Start Nov 18.");
    expect(edits?.textContent).toContain("Start Nov 25.");
  });

  it("does not repeat the text once the change is answered", async () => {
    const { container } = await show({ change: { ...change, state: "applied" } });
    expect(container.querySelector('[data-testid="wiki-change-edits"]')).toBeNull();
  });

  it("offers only to undo what was already added", async () => {
    const { container, buttons, click, onDecide } = await show({
      change: { ...change, state: "applied" },
    });
    expect(container.textContent).toContain("Added to the wiki");
    expect(buttons()).toContain("Undo");
    expect(buttons()).not.toContain("Approve");
    await click("Undo");
    expect(onDecide).toHaveBeenCalledWith("undo");
  });

  it.each([
    ["refused", "Refused"],
    ["undone", "Undone"],
    ["conflict", "A page changed since"],
  ] as const)("says only that it was %s, with nothing to press", async (state, text) => {
    const { container, buttons } = await show({ change: { ...change, state } });
    expect(container.textContent).toContain(text);
    expect(
      buttons().filter((label) => ["Approve", "Refuse", "Undo"].includes(label ?? "")),
    ).toEqual([]);
  });

  it("opens a page when its name is pressed", async () => {
    const { click, onOpenPage } = await show();
    await click("Alpha Builders");
    expect(onOpenPage).toHaveBeenCalledWith("Alpha Builders");
  });

  it("shows no reason or source to a reader who may not read the conversation", async () => {
    const { container } = await show({
      change: {
        ...change,
        reason: "",
        sourceTitle: "",
        canSeeSource: false,
        sourceText: undefined,
      },
    });
    expect(container.textContent).not.toContain("A contractor was chosen");
    expect(container.querySelector("details")).toBeNull();
  });

  it("quotes the source only for the person who may read it, and only on request", async () => {
    const own = await show();
    expect(own.container.querySelector("details")).not.toBeNull();
    expect(own.container.textContent).toContain("Ana: we are going with Alpha Builders.");
    await act(async () => root?.unmount());
    document.body.innerHTML = "";
    const other = await show({ change: { ...change, canSeeSource: false, sourceText: undefined } });
    expect(other.container.querySelector("details")).toBeNull();
    expect(other.container.textContent).not.toContain("Ana:");
  });

  it("holds the buttons while an answer is on its way", async () => {
    const { container } = await show({ busy: true });
    for (const button of container.querySelectorAll("button"))
      if (["Approve", "Refuse"].includes(button.textContent ?? ""))
        expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
