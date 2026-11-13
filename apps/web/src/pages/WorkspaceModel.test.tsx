// @vitest-environment jsdom
import type { MemberUsage, WorkspaceModel } from "@corvo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({
  workspaceModel: vi.fn(),
  setWorkspaceModel: vi.fn(),
  setUseOwnModel: vi.fn(),
  members: vi.fn(),
  setMemberLimit: vi.fn(),
}));

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
    i18n: { locale: "en" },
  }),
}));
vi.mock("../lib/query", () => ({
  useSpaceQueries: () => ({
    me: { key: () => ["me"] },
    models: {
      key: () => ["models"],
      workspaceModel: {
        queryKey: () => ["models", "workspaceModel"],
        queryOptions: () => ({
          queryKey: ["models", "workspaceModel"],
          queryFn: () => rpc.workspaceModel(),
        }),
      },
    },
    usage: {
      members: {
        queryKey: () => ["usage", "members"],
        queryOptions: () => ({ queryKey: ["usage", "members"], queryFn: () => rpc.members() }),
      },
    },
  }),
}));
vi.mock("../lib/space-rpc", () => ({
  useSpaceRpc: () => ({
    models: { setWorkspaceModel: rpc.setWorkspaceModel, setUseOwnModel: rpc.setUseOwnModel },
    usage: { setMemberLimit: rpc.setMemberLimit },
  }),
}));
vi.mock("@corvo/ui-web", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    onCheckedChange: (value: boolean) => void;
  } & Omit<ComponentProps<"button">, "onChange">) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      {...props}
    />
  ),
  Input: (props: ComponentProps<"input">) => <input {...props} />,
}));

import { MemberUsageSection } from "./MemberUsageSection";
import { WorkspaceModelRow } from "./WorkspaceModelRow";

let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.replaceChildren(host);
  for (const fn of Object.values(rpc)) fn.mockReset();
});

async function settle() {
  for (let i = 0; i < 6; i += 1)
    await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
}
async function mount(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    createRoot(host).render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>),
  );
  await settle();
}
const workspace = (patch: Partial<WorkspaceModel>): WorkspaceModel => ({
  isOwner: false,
  shared: false,
  useOwn: false,
  ...patch,
});

it("lets the owner share their models with the members", async () => {
  rpc.workspaceModel.mockResolvedValue(workspace({ isOwner: true }));
  rpc.setWorkspaceModel.mockImplementation(async () => {
    rpc.workspaceModel.mockResolvedValue(workspace({ isOwner: true, shared: true }));
    return workspace({ isOwner: true, shared: true });
  });
  await mount(<WorkspaceModelRow />);
  const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]');
  expect(host.textContent).toContain("Share my models with members");
  expect(toggle?.getAttribute("aria-checked")).toBe("false");
  await act(async () => toggle?.click());
  await settle();
  expect(rpc.setWorkspaceModel).toHaveBeenCalledWith({ shared: true });
  expect(host.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
});

it("shows a member nothing until models are lent, then offers their own", async () => {
  rpc.workspaceModel.mockResolvedValue(workspace({}));
  await mount(<WorkspaceModelRow />);
  expect(host.querySelector('[data-testid="workspace-model"]')).toBeNull();

  host.replaceChildren();
  rpc.workspaceModel.mockResolvedValue(workspace({ shared: true }));
  rpc.setUseOwnModel.mockResolvedValue(workspace({ shared: true, useOwn: true }));
  await mount(<WorkspaceModelRow />);
  expect(host.textContent).toContain("Use my own models");
  await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"]')?.click());
  await settle();
  expect(rpc.setUseOwnModel).toHaveBeenCalledWith({ useOwn: true });
});

const member = (patch: Partial<MemberUsage>): MemberUsage => ({
  userId: "member-1",
  name: "Ana",
  monthTokens: 1_500,
  monthlyTokenLimit: null,
  useOwn: false,
  ...patch,
});

it("shows an owner each member's month and saves a limit", async () => {
  rpc.workspaceModel.mockResolvedValue(workspace({ isOwner: true, shared: true }));
  rpc.members.mockResolvedValue([member({ userId: "owner-1", name: "Rui" }), member({})]);
  rpc.setMemberLimit.mockResolvedValue({ ok: true });
  await mount(<MemberUsageSection />);
  expect(host.textContent).toContain("Ana");
  expect(host.textContent).toContain("1.5K tokens");
  const input = host.querySelector<HTMLInputElement>(
    'input[aria-label="Monthly token limit for Ana"]',
  );
  expect(input).not.toBeNull();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "50000");
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    input?.blur();
  });
  await settle();
  expect(rpc.setMemberLimit).toHaveBeenCalledWith({
    userId: "member-1",
    monthlyTokenLimit: 50_000,
  });
});

it("shows a member no usage of others", async () => {
  rpc.workspaceModel.mockResolvedValue(workspace({ shared: true }));
  await mount(<MemberUsageSection />);
  expect(rpc.members).not.toHaveBeenCalled();
  expect(host.querySelector('[data-testid="member-usage"]')).toBeNull();
});
