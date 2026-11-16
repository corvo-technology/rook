// @vitest-environment jsdom
import type { MessageBlock } from "@corvo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { McpApprovalCard } from "./message-cards";

const api = vi.hoisted(() => ({
  update: vi.fn(),
  approve: vi.fn(),
  dismiss: vi.fn(),
  oauth: vi.fn(),
}));
vi.mock("../../lib/rpc", () => ({
  rpc: {
    mcp: {
      servers: { update: api.update },
      assignments: { approve: api.approve, dismiss: api.dismiss },
    },
  },
}));
vi.mock("../../lib/mcp-connect", () => ({ connectMcpOauth: api.oauth }));
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, i) => text + (i ? String(values[i - 1]) : "") + part, ""),
  }),
}));
type Block = Extract<MessageBlock, { kind: "mcp_approval" }>;
const keyBlock: Block = {
  kind: "mcp_approval",
  name: "PostHog",
  serverId: "srv_1",
  transport: "streamable_http",
  endpoint: "https://mcp.posthog.com/mcp",
  needsOAuth: false,
  needsKey: {
    label: "Personal API key",
    hint: "PostHog Project settings > Personal API keys",
    docsUrl: "https://posthog.com/docs/api",
  },
  status: "pending",
};

beforeEach(() => {
  api.update.mockReset().mockResolvedValue({});
  api.approve.mockReset().mockResolvedValue({});
  api.dismiss.mockReset().mockResolvedValue({ ok: true });
  api.oauth.mockReset().mockResolvedValue("connected");
});

async function mount(block: Block) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(<McpApprovalCard botId="bot_1" threadId="thread_1" block={block} />),
  );
  return { host, unmount: () => act(async () => root.unmount()) };
}

const button = (host: HTMLElement, text: string) =>
  Array.from(host.querySelectorAll("button")).find((item) => item.textContent === text) as
    | HTMLButtonElement
    | undefined;

async function typeKey(host: HTMLElement, value: string) {
  const input = host.querySelector("input") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("asks for the key with a masked field and its docs link, and cannot connect without one", async () => {
  const { host, unmount } = await mount(keyBlock);
  const input = host.querySelector("input") as HTMLInputElement;
  expect(input.type).toBe("password");
  expect(input.getAttribute("aria-label")).toBe("Personal API key");
  expect(host.querySelector('a[href="https://posthog.com/docs/api"]')).not.toBeNull();
  expect(button(host, "Connect")?.disabled).toBe(true);
  expect(button(host, "Approve")).toBeUndefined();
  await unmount();
});

it("saves the key to the server, then gives the agent access", async () => {
  const { host, unmount } = await mount(keyBlock);
  await typeKey(host, "  phx_secret  ");
  await act(async () => button(host, "Connect")?.click());
  expect(api.update).toHaveBeenCalledWith({ id: "srv_1", secret: "phx_secret" });
  expect(api.approve).toHaveBeenCalledWith({
    botId: "bot_1",
    serverId: "srv_1",
    threadId: "thread_1",
    level: "write",
  });
  expect(api.update.mock.invocationCallOrder[0]).toBeLessThan(
    api.approve.mock.invocationCallOrder[0]!,
  );
  expect(host.textContent).toContain("Connected");
  expect(host.querySelector("input")).toBeNull();
  await unmount();
});

it("gives no access and keeps asking when the key cannot be saved", async () => {
  api.update.mockRejectedValue(new Error("nope"));
  const { host, unmount } = await mount(keyBlock);
  await typeKey(host, "phx_secret");
  await act(async () => button(host, "Connect")?.click());
  expect(api.approve).not.toHaveBeenCalled();
  expect(button(host, "Connect")?.disabled).toBe(false);
  await unmount();
});

it("leaves a card without a key request as it was", async () => {
  const { host, unmount } = await mount({ ...keyBlock, needsKey: undefined });
  expect(host.querySelector("input")).toBeNull();
  await act(async () => button(host, "Approve")?.click());
  expect(api.update).not.toHaveBeenCalled();
  expect(api.approve).toHaveBeenCalled();
  await unmount();
});

const teammateBlock: Block = {
  kind: "mcp_approval",
  name: "Sentry",
  serverId: "srv_2",
  transport: "streamable_http",
  endpoint: "https://mcp.sentry.dev/mcp",
  needsOAuth: false,
  status: "pending",
  forBotId: "bot_infra",
  forBotName: "Infraestrutura e SRE",
};

it("says whom the access is for when an agent asked on a teammate's behalf", async () => {
  const { host, unmount } = await mount(teammateBlock);
  expect(host.textContent).toContain("Access for Infraestrutura e SRE");
  await unmount();
});

it("shows no such line on a card for the agent whose chat it is in", async () => {
  const { host, unmount } = await mount({
    ...teammateBlock,
    forBotId: undefined,
    forBotName: undefined,
  });
  expect(host.textContent).not.toContain("Access for");
  await unmount();
});

it("gives the access to the teammate, not to the agent whose chat shows the card", async () => {
  const { host, unmount } = await mount(teammateBlock);
  await act(async () => button(host, "Approve")?.click());
  expect(api.approve).toHaveBeenCalledWith({
    botId: "bot_infra",
    serverId: "srv_2",
    threadId: "thread_1",
    level: "write",
  });
  await unmount();
});

it("dismisses the card for the teammate too", async () => {
  const { host, unmount } = await mount(teammateBlock);
  await act(async () => button(host, "Not now")?.click());
  expect(api.dismiss).toHaveBeenCalledWith({
    botId: "bot_infra",
    serverId: "srv_2",
    threadId: "thread_1",
  });
  await unmount();
});

it("asks to give a teammate read access, and approving grants only read", async () => {
  const { host, unmount } = await mount({ ...teammateBlock, level: "read" });
  expect(host.textContent).toContain("Give Infraestrutura e SRE read access to Sentry?");
  await act(async () => button(host, "Approve")?.click());
  expect(api.approve).toHaveBeenCalledWith({
    botId: "bot_infra",
    serverId: "srv_2",
    threadId: "thread_1",
    level: "read",
  });
  await unmount();
});
