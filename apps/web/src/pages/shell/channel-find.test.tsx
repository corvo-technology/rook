// @vitest-environment jsdom

import type { ThreadMessage } from "@corvo/contracts";
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
vi.mock("@lingui/core/macro", () => ({
  t: (parts: TemplateStringsArray, ...values: unknown[]) => String.raw(parts, ...values),
}));

const rpcMock = vi.hoisted(() => ({
  search: { query: vi.fn() },
  threads: { pinned: vi.fn(), pin: vi.fn() },
}));
vi.mock("../../lib/rpc", () => ({ rpc: rpcMock }));

import { ChannelFind, pinSignature, SEARCH_DELAY_MS } from "./channel-find";

let root: Root;
let container: HTMLDivElement;
const onJump = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  rpcMock.search.query.mockReset();
  rpcMock.threads.pinned.mockReset().mockResolvedValue({ messages: [] });
  rpcMock.threads.pin.mockReset().mockResolvedValue({ ok: true, pinnedAt: null });
  onJump.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function render(pins = "") {
  await act(async () =>
    root.render(
      <ChannelFind
        groupId="group-1"
        channelName="finance"
        pins={pins}
        memberName={(botId) => (botId === "bento" ? "Bento" : undefined)}
        onJump={onJump}
      />,
    ),
  );
}

const byLabel = (label: string) =>
  document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`);

async function openSearch() {
  await act(async () => byLabel("Search")!.focus());
}

async function type(value: string) {
  const input = document.body.querySelector<HTMLInputElement>("input[type=search]")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const pinned = (id: string, text: string): ThreadMessage => ({
  id,
  threadId: "thread-1",
  seq: 1,
  role: "bot",
  botId: "bento",
  blocks: [{ kind: "text", text }],
  createdAt: "2026-11-10T09:00:00.000Z",
  pinnedAt: "2026-11-10T10:00:00.000Z",
});

it("searches only this channel, after typing pauses, and shows the matches", async () => {
  rpcMock.search.query.mockResolvedValue({
    hits: [
      {
        kind: "message",
        groupId: "group-1",
        title: "financeiro",
        snippet: "A tarifa entrou duas vezes",
        messageId: "m1",
        seq: 3,
      },
    ],
  });
  await render();
  await openSearch();
  await type("tarifa");
  expect(rpcMock.search.query).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(SEARCH_DELAY_MS));
  expect(rpcMock.search.query).toHaveBeenCalledWith({
    q: "tarifa",
    within: { groupId: "group-1" },
  });
  expect(document.body.textContent).toContain("A tarifa entrou duas vezes");
});

it("jumps to the message of a match and closes the search", async () => {
  rpcMock.search.query.mockResolvedValue({
    hits: [
      {
        kind: "message",
        groupId: "group-1",
        title: "x",
        snippet: "DRE de outubro",
        messageId: "m9",
      },
    ],
  });
  await render();
  await openSearch();
  await type("DRE");
  await act(async () => vi.advanceTimersByTime(SEARCH_DELAY_MS));
  await act(async () =>
    document.body
      .querySelector<HTMLElement>("[data-testid=channel-search-results] button")!
      .click(),
  );
  expect(onJump).toHaveBeenCalledWith("m9");
  expect(document.body.querySelector("[data-testid=channel-search-results]")).toBeNull();
});

it("says so when nothing matches, and when the search fails", async () => {
  rpcMock.search.query.mockResolvedValueOnce({ hits: [] });
  await render();
  await openSearch();
  await type("zzz");
  await act(async () => vi.advanceTimersByTime(SEARCH_DELAY_MS));
  expect(document.body.textContent).toContain("No matches");
  rpcMock.search.query.mockRejectedValueOnce(new Error("down"));
  await type("zzzz");
  await act(async () => vi.advanceTimersByTime(SEARCH_DELAY_MS));
  expect(document.body.textContent).toContain("Could not search");
});

it("does not search an empty box", async () => {
  await render();
  await openSearch();
  await type("   ");
  await act(async () => vi.advanceTimersByTime(SEARCH_DELAY_MS * 2));
  expect(rpcMock.search.query).not.toHaveBeenCalled();
});

it("keeps the pin button, with nothing to open, until something is pinned", async () => {
  await render();
  expect((byLabel("Pinned messages") as HTMLButtonElement).disabled).toBe(true);
});

it("lists the pinned messages with who wrote them, and jumps to one", async () => {
  rpcMock.threads.pinned.mockResolvedValue({ messages: [pinned("m1", "Fechamento de outubro")] });
  await render("m1:x");
  expect(rpcMock.threads.pinned).toHaveBeenCalledWith({ groupId: "group-1" });
  await act(async () => byLabel("Pinned messages")!.click());
  const list = document.body.querySelector("[data-testid=channel-pins]")!;
  expect(list.textContent).toContain("Bento");
  expect(list.textContent).toContain("Fechamento de outubro");
  await act(async () => list.querySelector<HTMLElement>("button")!.click());
  expect(onJump).toHaveBeenCalledWith("m1");
});

it("unpins from the list", async () => {
  rpcMock.threads.pinned.mockResolvedValue({ messages: [pinned("m1", "Fechamento")] });
  await render("m1:x");
  await act(async () => byLabel("Pinned messages")!.click());
  await act(async () => byLabel("Unpin")!.click());
  expect(rpcMock.threads.pin).toHaveBeenCalledWith({
    groupId: "group-1",
    messageId: "m1",
    pinned: false,
  });
});

it("reads the pins again when the signature changes", async () => {
  rpcMock.threads.pinned.mockResolvedValue({ messages: [pinned("m1", "A")] });
  await render("a");
  await render("b");
  expect(rpcMock.threads.pinned).toHaveBeenCalledTimes(2);
});

it("names a change to the loaded pins", () => {
  const a = { id: "m1", pinnedAt: "t1" };
  const b = { id: "m2", pinnedAt: undefined };
  expect(pinSignature([a, b])).toBe("m1:t1");
  expect(pinSignature([a, { ...b, pinnedAt: "t2" }])).toBe("m1:t1,m2:t2");
  expect(pinSignature([b])).toBe("");
});
