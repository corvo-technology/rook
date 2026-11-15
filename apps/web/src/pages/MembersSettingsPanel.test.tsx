// @vitest-environment jsdom

import type { Space } from "@corvo/contracts";
import { ADMIN_DEFAULT_KEYS } from "@corvo/core";
import type { ComponentProps, ReactNode } from "react";
import { act, createContext, useContext } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MembersSettingsPanel } from "./MembersSettingsPanel";

const group = () => ({
  members: { list: vi.fn(), setRole: vi.fn(), setRoles: vi.fn(), remove: vi.fn(), leave: vi.fn() },
  roles: { list: vi.fn() },
  invitations: { list: vi.fn(), create: vi.fn(), resend: vi.fn(), cancel: vi.fn() },
  inviteLink: { get: vi.fn(), create: vi.fn(), disable: vi.fn() },
  joinRequests: { list: vi.fn(), answer: vi.fn() },
});
const clients = vi.hoisted(() => new Map<string, ReturnType<typeof group>>());
const create = vi.hoisted(() => vi.fn());
const setMembersCanCreate = vi.hoisted(() => vi.fn());
vi.mock("../lib/rpc", () => ({
  rpc: { spaces: { create, setMembersCanCreate } },
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
  client.roles.list.mockImplementation(async () => {
    const list = (await client.members.list()) as Array<{ userId: string; role: string }>;
    const role = list?.find((member) => member.userId === currentUser)?.role ?? "member";
    return {
      roles: [],
      me: {
        isOwner: role === "owner",
        roleIds: [],
        permissions: role === "admin" ? [...ADMIN_DEFAULT_KEYS] : [],
      },
    };
  });
  client.invitations.list.mockResolvedValue([]);
  client.joinRequests.list.mockResolvedValue([]);
  client.inviteLink.get.mockResolvedValue({ link: null });
}
let currentUser = "";
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
  Plural: ({ value, one, other }: { value: number; one: string; other: string }) =>
    (value === 1 ? one : other).replace("#", String(value)),
}));
vi.mock("@corvo/ui-web", () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<"button"> & { variant?: string; size?: string }) => <button {...props} />,
  Input: (props: ComponentProps<"input">) => <input {...props} />,
  Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, ...props }: ComponentProps<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: ComponentProps<"button">) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuCheckboxItem: ({
    children,
    checked,
    onCheckedChange,
  }: {
    children: ReactNode;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
  }) => (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
    >
      {children}
    </button>
  ),
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
  // biome-ignore lint/a11y/noLabelWithoutControl: test double; the real Label gets its htmlFor
  Label: (props: ComponentProps<"label">) => <label {...props} />,
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: Omit<ComponentProps<"button">, "onChange"> & {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      {...props}
    />
  ),
}));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const joined = "2026-11-12T10:00:00.000Z";
const person = (userId: string, role: "owner" | "admin" | "member") => ({
  userId,
  name: userId,
  email: `${userId}@example.test`,
  role,
  roleIds: [],
  joinedAt: joined,
});

beforeEach(() => {
  vi.clearAllMocks();
  onCreated.mockReset();
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
const onPolicy = vi.fn();

async function render(
  userId: string,
  options: {
    spaces?: Space[];
    current?: string;
    canCreateSpace?: boolean;
    membersCanCreateSpaces?: boolean | null;
  } = {},
) {
  currentUser = userId;
  await act(async () => {
    root.render(
      <MembersSettingsPanel
        userId={userId}
        spaces={options.spaces ?? [space("s1", "Home", true)]}
        currentSpaceId={options.current ?? "s1"}
        onCreated={onCreated}
        canCreateSpace={options.canCreateSpace}
        membersCanCreateSpaces={options.membersCanCreateSpaces}
        onMembersCanCreateSpaces={onPolicy}
      />,
    );
  });
}

const click = async (node: Element | null) => {
  await act(async () => {
    (node as HTMLElement).click();
  });
};
const type = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  await act(async () => {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set?.call(input, value);
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

const ops = {
  id: "r-ops",
  name: "Ops",
  color: null,
  position: 1,
  keys: ["view_usage"],
  systemKey: null,
  memberCount: 1,
};

it("pastes many addresses at once, skips people already in, and says how many were sent", async () => {
  spaces.members.list.mockResolvedValue([person("ana", "owner"), person("bia", "member")]);
  spaces.invitations.create.mockResolvedValue({
    emailed: true,
    invitations: [{ id: "i1" }, { id: "i2" }],
    alreadyMembers: [],
  });
  await render("ana");
  await vi.waitFor(() =>
    expect(host.querySelector('textarea[aria-label="Email addresses"]')).not.toBeNull(),
  );
  await type(
    host.querySelector('textarea[aria-label="Email addresses"]') as HTMLTextAreaElement,
    "c@example.test\td@example.test, BIA@example.test; c@example.test",
  );
  expect(host.textContent).toContain("bia@example.test already in the space");
  await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Invite") ?? null);
  expect(spaces.invitations.create).toHaveBeenCalledWith({
    addresses: "c@example.test\nd@example.test",
    role: "member",
    roleIds: [],
  });
  expect(host.querySelector('[role="status"]')?.textContent).toBe("2 invitations sent");
});

it("holds the invitation back while an entry is not an address", async () => {
  spaces.members.list.mockResolvedValue([person("ana", "owner")]);
  await render("ana");
  await vi.waitFor(() =>
    expect(host.querySelector('textarea[aria-label="Email addresses"]')).not.toBeNull(),
  );
  await type(
    host.querySelector('textarea[aria-label="Email addresses"]') as HTMLTextAreaElement,
    "ok@example.test, nobody",
  );
  expect(host.textContent).toContain("nobody");
  const send = [...host.querySelectorAll("button")].find((b) => b.textContent === "Invite");
  expect((send as HTMLButtonElement).disabled).toBe(true);
});

it("lists only waiting invitations, first, beside the people; an accepted one is just a member", async () => {
  spaces.members.list.mockResolvedValue([person("ana", "owner"), person("joao", "member")]);
  spaces.invitations.list.mockResolvedValue([
    {
      id: "i1",
      email: "novo@example.test",
      role: "member",
      roleIds: [],
      status: "pending",
      expiresAt: joined,
      createdAt: joined,
      acceptedByName: null,
      link: "https://x.test/invite/i1",
    },
    {
      id: "i2",
      email: "joao@example.test",
      role: "member",
      roleIds: [],
      status: "accepted",
      expiresAt: joined,
      createdAt: joined,
      acceptedByName: "joao",
      link: null,
    },
  ]);
  await render("ana");
  const list = host.querySelector('[data-testid="members-list"]')?.textContent ?? "";
  expect(list).not.toContain("joined");
  expect(list.indexOf("novo@example.test")).toBeLessThan(list.indexOf("ana@example.test"));
  expect(list).toContain("Invitation sent");
  expect(list.match(/joao@example.test/g)).toHaveLength(1);
  await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Resend") ?? null);
  expect(spaces.invitations.resend).toHaveBeenCalledWith({ id: "i1" });
});

it("names a person by the start of their address when the name is only a placeholder", async () => {
  spaces.members.list.mockResolvedValue([
    { ...person("ana", "owner"), name: "Account", email: "ana.souza@example.test" },
  ]);
  await render("ana");
  expect(host.textContent).toContain("ana.souza");
  expect(host.textContent).not.toContain("Account");
});

it("lets only someone who manages members change roles, and never their own", async () => {
  spaces.members.list.mockResolvedValue([
    person("ana", "owner"),
    { ...person("bia", "member"), roleIds: ["r-ops"] },
  ]);
  spaces.roles.list.mockResolvedValue({
    roles: [ops],
    me: { isOwner: true, roleIds: [], permissions: [] },
  });
  await render("ana");
  expect(host.querySelector('button[aria-label="Roles of bia"]')).not.toBeNull();
  expect(host.querySelector('button[aria-label="Roles of ana"]')).toBeNull();
  await click(
    [...host.querySelectorAll('[role="menuitemcheckbox"]')].find((b) => b.textContent === "Ops") ??
      null,
  );
  expect(spaces.members.setRoles).toHaveBeenCalledWith({ userId: "bia", roleIds: [] });
  await click(
    [...host.querySelectorAll('[role="menuitemcheckbox"]')].find(
      (b) => b.textContent === "Admin",
    ) ?? null,
  );
  expect(spaces.members.setRole).toHaveBeenCalledWith({ userId: "bia", role: "admin" });

  spaces.roles.list.mockResolvedValue({
    roles: [ops],
    me: { isOwner: false, roleIds: [], permissions: [] },
  });
  await render("bia");
  expect(host.querySelector('button[aria-label^="Roles of"]')).toBeNull();
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

  await type(
    host.querySelector('textarea[aria-label="Email addresses"]') as HTMLTextAreaElement,
    "d@example.test",
  );
  await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Invite") ?? null);
  expect(staff.invitations.create).toHaveBeenCalledWith({
    addresses: "d@example.test",
    role: "member",
    roleIds: [],
  });
  expect(spaces.invitations.create).not.toHaveBeenCalled();
});

it("shows each person's custom roles and lets an invitation carry one", async () => {
  spaces.members.list.mockResolvedValue([
    person("ana", "owner"),
    { ...person("bia", "member"), roleIds: ["r-ops"] },
  ]);
  spaces.invitations.create.mockResolvedValue({
    emailed: true,
    invitations: [],
    alreadyMembers: [],
  });
  spaces.roles.list.mockResolvedValue({
    roles: [
      {
        id: "r-ops",
        name: "Ops",
        color: null,
        position: 1,
        keys: ["view_usage"],
        systemKey: null,
        memberCount: 1,
      },
    ],
    me: { isOwner: true, roleIds: [], permissions: [] },
  });
  await render("ana");
  expect(host.textContent).toContain("Ops");
  await type(
    host.querySelector('textarea[aria-label="Email addresses"]') as HTMLTextAreaElement,
    "e@example.test",
  );
  await click(host.querySelector('[data-pick="r-ops"]'));
  await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Invite") ?? null);
  expect(spaces.invitations.create).toHaveBeenCalledWith({
    addresses: "e@example.test",
    role: "member",
    roleIds: ["r-ops"],
  });
});

it("lets only the owner switch whether members create spaces", async () => {
  spaces.members.list.mockResolvedValue([person("ana", "owner"), person("bia", "member")]);
  setMembersCanCreate.mockResolvedValue({ allowed: true });
  await render("ana", { membersCanCreateSpaces: false });
  await vi.waitFor(() =>
    expect(host.querySelector('[data-testid="members-can-create-spaces"]')).not.toBeNull(),
  );
  const toggle = host.querySelector('[data-testid="members-can-create-spaces"]');
  expect(toggle?.getAttribute("aria-checked")).toBe("false");
  await click(toggle);
  expect(setMembersCanCreate).toHaveBeenCalledWith({ allowed: true });
  expect(onPolicy).toHaveBeenCalledWith(true);

  await render("bia", { membersCanCreateSpaces: null });
  expect(host.querySelector('[data-testid="members-can-create-spaces"]')).toBeNull();
});

it("offers a new workspace only to someone who may create one", async () => {
  spaces.members.list.mockResolvedValue([person("ana", "owner")]);
  await render("ana", { spaces: two, canCreateSpace: false });
  const options = [...host.querySelectorAll("[data-pick]")].map((node) =>
    node.getAttribute("data-pick"),
  );
  expect(options).not.toContain("new-workspace");
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
