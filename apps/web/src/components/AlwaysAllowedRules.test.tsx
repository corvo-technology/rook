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

const rules = vi.hoisted(() => ({
  current: [] as Array<{
    id: string;
    botId: string;
    botName: string;
    connection: string;
    tool: string;
    createdAt: string;
  }>,
}));
const rpc = vi.hoisted(() => ({
  scopedApprovalRules: { remove: vi.fn(async () => ({ ok: true })) },
}));
const input = vi.hoisted(() => ({ seen: undefined as unknown }));
vi.mock("../lib/space-rpc", () => ({ useSpaceRpc: () => rpc }));
vi.mock("../lib/query", () => ({
  useSpaceQueries: () => ({
    scopedApprovalRules: {
      list: {
        queryOptions: (options: { input: unknown }) => {
          input.seen = options.input;
          return {};
        },
        queryKey: () => ["rules"],
      },
    },
  }),
}));
vi.mock("@corvo/core/query", () => ({
  writeSaved: async (
    _client: unknown,
    _key: unknown,
    update: (current: typeof rules.current) => typeof rules.current,
  ) => {
    rules.current = update(rules.current);
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: rules.current }),
  useQueryClient: () => ({}),
}));

import { AlwaysAllowedRules } from "./AlwaysAllowedRules";

let container: HTMLDivElement;
let root: Root;
const rule = (id: string, botName: string, tool: string) => ({
  id,
  botId: `bot-${botName}`,
  botName,
  connection: "gmail",
  tool,
  createdAt: "2026-11-20T00:00:00.000Z",
});

beforeEach(() => {
  rules.current = [
    rule("r1", "Ada", "gmail_send_email"),
    rule("r2", "Grace", "gmail_create_draft"),
  ];
  rpc.scopedApprovalRules.remove.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("shows nothing until a rule exists", async () => {
  rules.current = [];
  await act(async () => root.render(<AlwaysAllowedRules botId="bot-Ada" />));
  expect(container.innerHTML).toBe("");
});

it("lists one agent's rules on its page and removes one", async () => {
  await act(async () => root.render(<AlwaysAllowedRules botId="bot-Ada" />));
  expect(input.seen).toEqual({ botId: "bot-Ada" });
  expect(container.textContent).toContain("Always allowed");
  const remove = container.querySelector<HTMLButtonElement>('button[aria-label^="Remove"]')!;
  await act(async () => remove.click());
  expect(rpc.scopedApprovalRules.remove).toHaveBeenCalledWith({ id: "r1" });
  expect(container.textContent?.toLowerCase()).not.toContain("send");
});

it("names the agent when settings list every agent's rules", async () => {
  await act(async () => root.render(<AlwaysAllowedRules />));
  expect(input.seen).toBeUndefined();
  expect(container.textContent).toContain("Ada · ");
  expect(container.textContent).toContain("Grace · ");
});
