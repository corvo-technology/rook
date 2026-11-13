// @vitest-environment jsdom

import type { Space } from "@corvo/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act, createContext, useContext } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MembersSettingsPanel } from "./MembersSettingsPanel";

const group = () => ({
  members: { list: vi.fn(), setRole: vi.fn(), remove: vi.fn(), leave: vi.fn() },
  invitations: { list: vi.fn(), create: vi.fn(), resend: vi.fn(), cancel: vi.fn() },
  inviteLink: { get: vi.fn(), create: vi.fn(), disable: vi.fn() },
  joinRequests: { list: vi.fn(), answer: vi.fn() },
});
const clients = vi.hoisted(() => new Map<string, ReturnType<typeof group>>());
const create = vi.hoisted(() => vi.fn());
vi.mock("../lib/rpc", () => ({
  rpc: { spaces: { create } },
  rpcForSpace: (id: string) => {
    const client = clientFor(id);
    if (!rpcClients.has(client)) rpcClients.set(client, { spaces: client });
    return rpcClients.get(client);
  },
}));
const rpcClients = new Map<object, object>();
function clientFor(id: string) {
  let client = clients.get(id);
  if (!client) {
    client = group();
    clients.set(id, client);
    prepare(client);
  }
  return client;
}
function prepare(client: ReturnType<typeof group>) {
  for (const calls of Object.values(client))
    for (const fn of Object.values(calls)) fn.mockReset().mockResolvedValue({ ok: true });
  client.invitations.list.mockResolvedValue([]);
  client.joinRequests.list.mockResolvedValue([]);
  client.inviteLink.get.mockResolvedValue({ link: null });
}
const spaces = clientFor("s1");
const PickContext = createContext<(value: string) => void>(() => undefined);
function PickItem({ children, value }: { children: ReactNode; value: string }) {
  const pick = useContext(PickContext);
  return (
    <button type="button" data-pick={value} onClick={() => pick(value)}>
      {children}
    </button>
  );
}
const lingui = vi.hoisted(() => ({
  i18n: { locale: "en" },
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((text, part, index) => text + part + String(values[index] ?? ""), ""),
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => lingui,
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@corvo/ui-web", () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<"button"> & { variant?: string; size?: string }) => <button {...props} />,
  Input: (props: ComponentProps<"input">) => <input {...props} />,
  InlineConfirm: ({
    children,
    confirmLabel,
    onConfirm,
  }: {
    children: ReactNode;
    confirmLabel: string;
    onConfirm: () => void;
  }) => (
    <button type="button" aria-label={confirmLabel} onClick={onConfirm}>
      {children}
    </button>
  ),
  Select: ({
    children,
    onValueChange,
  }: {
    children: ReactNode;
    onValueChange: (value: string) => void;
  }) => <PickContext.Provider value={onValueChange}>{children}</PickContext.Provider>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <PickItem value={value}>{children}</PickItem>
  ),
  SelectTrigger: ({ children, ...props }: ComponentProps<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  SelectValue: () => null,
}));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const joined = "2026-11-12T10:00:00.000Z";
const person = (userId: string, role: "owner" | "admin" | "member") => ({
  userId,
  name: userId,
  email: `${userId}@example.test`,
  role,
  joinedAt: joined,
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const client of clients.values()) prepare(client);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const space = (id: string, name: string, canInvite: boolean) =>
  ({ id, name, canInvite }) as unknown as Space;
const onCreated = vi.fn();

async function render(userId: string, options: { spaces?: Space[]; current?: string } = {}) {
  await act(async () => {
    root.render(
      <MembersSettingsPanel
        userId={userId}
        spaces={options.spaces ?? [space("s1", "Home", true)]}
        currentSpaceId={options.current ?? "s1"}
        onCreated={onCreated}
      />,
    );
  });
}

const click = async (node: Element | null) => {
  await act(async () => {
    (node as HTMLElement).click();
  });
};
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

it("lets an owner invite, and shows who asked to join", async () => {
  spaces.members.list.mockResolvedValue([person("ana", "owner"), person("bia", "member")]);
  spaces.joinRequests.list.mockResolvedValue([
    { id: "r1", name: "Caio", email: "caio@example.test", createdAt: joined },
  ]);
  await render("ana");
  expect(host.textContent).toContain("bia@example.test");
  expect(host.textContent).toContain("Caio");
  expect(host.querySelector('button[aria-label="Remove bia?"]')).not.toBeNull();
  expect(host.textContent).toContain("Invite");
});

it("shows a plain member the team and nothing to manage", async () => {
  spaces.members.list.mockResolvedValue([person("ana", "owner"), person("bia", "member")]);
  await render("bia");
  expect(host.textContent).toContain("ana@example.test");
  expect(host.querySelector('button[aria-label="Remove ana?"]')).toBeNull();
  expect(host.querySelector('button[aria-label="Leave this space?"]')).not.toBeNull();
  expect(spaces.invitations.list).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("Invite link");
});

it("keeps an admin away from owners", async () => {
  spaces.members.list.mockResolvedValue([person("ana", "owner"), person("bia", "admin")]);
  await render("bia");
  expect(host.querySelector('button[aria-label="Remove ana?"]')).toBeNull();
});

const two = [space("s1", "Home", true), space("s2", "Staff", true), space("s3", "Guest", false)];

it("lists only the workspaces the person can invite to, and hides the picker for one", async () => {
  spaces.members.list.mockResolvedValue([person("ana", "owner")]);
  await render("ana", { spaces: [space("s1", "Home", true), space("s3", "Guest", false)] });
  expect(host.querySelector('button[aria-label="Workspace"]')).toBeNull();

  await render("ana", { spaces: two });
  expect(host.querySelector('button[aria-label="Workspace"]')).not.toBeNull();
  const options = [...host.querySelectorAll("[data-pick]")].map((node) =>
    node.getAttribute("data-pick"),
  );
  expect(options).toEqual(expect.arrayContaining(["s1", "s2", "new-workspace"]));
  expect(options).not.toContain("s3");
});

it("follows the picked workspace for members and invitations", async () => {
  spaces.members.list.mockResolvedValue([person("ana", "owner")]);
  const staff = clientFor("s2");
  staff.members.list.mockResolvedValue([person("ana", "admin"), person("caio", "member")]);
  staff.invitations.create.mockResolvedValue({
    emailed: true,
    invitations: [],
    alreadyMembers: [],
  });
  await render("ana", { spaces: two });
  expect(host.textContent).not.toContain("caio@example.test");

  await click(host.querySelector('[data-pick="s2"]'));
  expect(staff.members.list).toHaveBeenCalled();
  expect(host.textContent).toContain("caio@example.test");

  await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Invite") ?? null);
  await type(
    host.querySelector('input[aria-label="Email addresses"]') as HTMLInputElement,
    "d@example.test",
  );
  const buttons = [...host.querySelectorAll("button")].filter((b) => b.textContent === "Invite");
  await click(buttons[buttons.length - 1] ?? null);
  expect(staff.invitations.create).toHaveBeenCalledWith({
    addresses: "d@example.test",
    role: "member",
  });
  expect(spaces.invitations.create).not.toHaveBeenCalled();
});

it("creates a workspace inline and picks it", async () => {
  spaces.members.list.mockResolvedValue([person("ana", "owner")]);
  create.mockResolvedValue(space("s4", "Team", true));
  const added = clientFor("s4");
  added.members.list.mockResolvedValue([person("ana", "owner")]);
  onCreated.mockImplementation(
    (created: Space) => void render("ana", { spaces: [...two, created] }),
  );
  await render("ana", { spaces: two });
  await click(host.querySelector('[data-pick="new-workspace"]'));
  await type(host.querySelector('input[aria-label="Workspace name"]') as HTMLInputElement, "Team");
  await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Create") ?? null);
  expect(create).toHaveBeenCalledWith({ name: "Team", locale: "en" });
  expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "s4" }));
  expect(added.members.list).toHaveBeenCalled();
});
