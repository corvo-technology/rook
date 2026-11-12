// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
const decide = vi.hoisted(() => vi.fn());
const retry = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
vi.mock("../lib/space-rpc", () => ({
  useSpaceRpc: () => ({ wiki: { changes: { get, decide, retry } } }),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: unknown }) => children,
}));
vi.mock("@corvo/ui-web", () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
  Button: (props: React.ComponentProps<"button">) => <button type="button" {...props} />,
}));

import { WikiChangeBlock } from "./WikiChangeBlock";

const change = (state: string) => ({
  id: "chg1",
  state,
  reason: "A contractor was chosen",
  sourceTitle: "Lobby renovation",
  pages: [{ title: "Alpha Builders", op: "create" }],
  edits: [],
  createdAt: "2026-11-04T10:00:00.000Z",
  canSeeSource: false,
});

let root: ReturnType<typeof createRoot> | undefined;
beforeEach(() => {
  get.mockReset();
  decide.mockReset();
  retry.mockReset();
  navigate.mockReset();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function show() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <WikiChangeBlock changeId="chg1" />
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 10 && !container.querySelector('[data-testid="wiki-change"]'); i++)
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  return container;
}
const press = async (container: HTMLElement, label: string) =>
  act(async () => {
    [...container.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
  });

describe("the card in a conversation", () => {
  it("shows the change as it stands now, not as it was when it was kept", async () => {
    get.mockResolvedValue(change("pending"));
    const container = await show();
    expect(get).toHaveBeenCalledWith({ changeId: "chg1" });
    expect(container.querySelector('[data-testid="wiki-change"]')?.getAttribute("data-state")).toBe(
      "pending",
    );
  });

  it("shows nothing at all for a change that cannot be read", async () => {
    get.mockRejectedValue(new Error("not found"));
    const container = await show();
    expect(container.querySelector('[data-testid="wiki-change"]')).toBeNull();
  });

  it("sends the person's answer and shows the state it reaches", async () => {
    // After the answer the server reports the state it reached, whichever way it is asked.
    get.mockResolvedValueOnce(change("pending")).mockResolvedValue(change("applied"));
    decide.mockResolvedValue(change("applied"));
    const container = await show();
    await press(container, "Approve");
    expect(decide).toHaveBeenCalledWith({ changeId: "chg1", decision: "apply" });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    expect(container.querySelector('[data-testid="wiki-change"]')?.getAttribute("data-state")).toBe(
      "applied",
    );
  });

  it("offers to try a conflicting change again, and asks only once", async () => {
    get.mockResolvedValue(change("conflict"));
    retry.mockResolvedValue({ ok: true });
    const container = await show();
    await press(container, "Try again");
    expect(retry).toHaveBeenCalledWith({ changeId: "chg1" });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    await press(container, "Try again");
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("does not offer a retry for a change that is not in conflict", async () => {
    get.mockResolvedValue(change("pending"));
    const container = await show();
    expect(
      [...container.querySelectorAll("button")].some((b) => b.textContent === "Try again"),
    ).toBe(false);
  });

  it("opens a page in the Wiki", async () => {
    get.mockResolvedValue(change("applied"));
    const container = await show();
    await press(container, "Alpha Builders");
    expect(navigate).toHaveBeenCalledWith("/app/wiki?page=Alpha%20Builders");
  });
});
