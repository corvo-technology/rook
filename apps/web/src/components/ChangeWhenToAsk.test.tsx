// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock(
  "@corvo/ui-web",
  async () => (await import("../test-support/ui-web-choice-doubles")).choiceDoubles,
);

const rpc = vi.hoisted(() => ({ bots: { update: vi.fn(async () => ({})) } }));
const invalidateQueries = vi.hoisted(() => vi.fn(async () => undefined));
const bot = vi.hoisted(() => ({ approvalMode: null as string | null }));
vi.mock("../lib/space-rpc", () => ({ useSpaceRpc: () => rpc }));
vi.mock("../lib/query", () => ({
  useSpaceQueries: () => ({
    bots: {
      get: { queryOptions: () => ({ key: "bot" }), queryKey: () => ["bot"] },
      list: { queryKey: () => ["bots"] },
    },
    autoReview: { get: { queryOptions: () => ({ key: "level" }) } },
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { key: string; enabled?: boolean }) => ({
    data: !options.enabled
      ? undefined
      : options.key === "bot"
        ? { approvalMode: bot.approvalMode }
        : { mode: "risky", checkerAvailable: false },
  }),
  useQueryClient: () => ({ invalidateQueries }),
}));

import { ChangeWhenToAsk } from "./ChangeWhenToAsk";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  bot.approvalMode = null;
  rpc.bots.update.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const button = (text: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === text)!;
const radio = (mode: string) =>
  [...container.querySelectorAll<HTMLElement>('[role="radio"]')].find(
    (r) => r.dataset.value === mode,
  )!;

it("opens the agent's levels in place, changes them and undoes the change", async () => {
  await act(async () => root.render(<ChangeWhenToAsk botId="bot-1" name="Ada" />));
  expect(container.querySelector('[role="radio"]')).toBeNull();

  await act(async () => button("Change when to ask").click());
  await act(async () => radio("always").click());
  expect(rpc.bots.update).toHaveBeenCalledWith({ botId: "bot-1", approvalMode: "always" });

  await act(async () => button("Undo").click());
  expect(rpc.bots.update).toHaveBeenLastCalledWith({ botId: "bot-1", approvalMode: null });
  expect(rpc.bots.update).toHaveBeenCalledTimes(2);
});
