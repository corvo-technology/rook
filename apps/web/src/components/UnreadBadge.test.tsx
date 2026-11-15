// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { UnreadBadge } from "./UnreadBadge";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
}));

async function render(props: Parameters<typeof UnreadBadge>[0]) {
  const host = document.createElement("div");
  await act(async () => createRoot(host).render(<UnreadBadge {...props} />));
  return host;
}

it("shows the count, capped at 99+", async () => {
  expect((await render({ count: 7, unread: true })).textContent).toContain("7");
  expect((await render({ count: 100, unread: true })).textContent).toContain("99+");
});

it("wears the strong style only when someone is named", async () => {
  const plain = (await render({ count: 2, unread: true })).querySelector(
    "[data-roster-unread-count]",
  );
  const named = (await render({ count: 2, mentions: 1, unread: true })).querySelector(
    "[data-roster-unread-count]",
  );
  expect(plain?.hasAttribute("data-mention")).toBe(false);
  expect(plain?.className).toContain("bg-secondary");
  expect(named?.getAttribute("data-mention")).toBe("true");
  expect(named?.className).toContain("bg-primary");
});

it("falls back to the dot without a count and shows nothing once read", async () => {
  expect((await render({ unread: true })).querySelector("[data-roster-unread-dot]")).not.toBeNull();
  expect((await render({ count: 3, unread: false })).textContent).toBe("");
});
