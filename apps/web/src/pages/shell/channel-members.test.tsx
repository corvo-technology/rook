// @vitest-environment jsdom
import type { CustomSpaceRole, SpaceMember } from "@corvo/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
}));
vi.mock("../../lib/query", () => ({ useSpaceQueries: () => ({}) }));
vi.mock("../../lib/rpc", () => ({ rpc: {} }));

import { ChannelMembersPanel } from "./channel-members";

const role = (id: string, name: string, position: number, systemKey: "admin" | "everyone" | null) =>
  ({
    id,
    name,
    position,
    systemKey,
    color: null,
    keys: [],
    memberCount: 0,
  }) satisfies CustomSpaceRole;
const roles = [role("r-fin", "Finance", 1, null), role("r-all", "Everyone", 99, "everyone")];
const person = (userId: string, name: string, kind: SpaceMember["role"], roleIds: string[] = []) =>
  ({
    userId,
    name,
    email: `${userId}@example.test`,
    role: kind,
    roleIds,
    joinedAt: "2026-11-01T00:00:00.000Z",
  }) satisfies SpaceMember;
const members = [
  person("u-pedro", "Pedro", "owner"),
  person("u-joao", "Joao", "member", ["r-fin"]),
  person("u-marta", "Marta", "member"),
];
const agents = [
  { id: "bot-bento", name: "Bento", title: "Finance", color: "#75aef5" },
  { id: "bot-cora", name: "Cora", title: "Reports", color: "#b797ef" },
];

let host: HTMLDivElement | undefined;
afterEach(() => {
  host?.remove();
  host = undefined;
});

async function render(props: Partial<ComponentProps<typeof ChannelMembersPanel>> = {}) {
  host = document.createElement("div");
  document.body.append(host);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const handlers = {
    onClose: vi.fn(),
    onAddPeople: vi.fn(),
    onAddAgent: vi.fn(),
    onRemovePerson: vi.fn(),
    onMakePrivate: vi.fn(),
    onOpenToEveryone: vi.fn(),
  };
  await act(async () =>
    createRoot(host!).render(
      <ChannelMembersPanel
        members={members}
        roles={roles}
        people={{ restricted: false, userIds: [], canManage: false }}
        agents={agents}
        allAgents={agents}
        currentUserId="u-pedro"
        {...handlers}
        {...props}
      />,
    ),
  );
  return handlers;
}

const headings = () =>
  [...host!.querySelectorAll("h3")].map((heading) => heading.textContent?.trim());

it("groups people by their highest role, then lists the agents with what they do", async () => {
  await render();
  expect(headings()).toEqual(["Owner", "Finance", "Everyone", "Agents"]);
  const text = host!.textContent ?? "";
  expect(text).toContain("Who sees this channel");
  expect(text.indexOf("Pedro")).toBeLessThan(text.indexOf("Joao"));
  expect(text.indexOf("Joao")).toBeLessThan(text.indexOf("Marta"));
  expect(text).toContain("Bento");
  expect(text).toContain("Reports");
});

it("shows only the people added to a private channel", async () => {
  await render({ people: { restricted: true, userIds: ["u-pedro", "u-marta"], canManage: false } });
  expect(headings()).toEqual(["Owner", "Everyone", "Agents"]);
  expect(host!.textContent).not.toContain("Joao");
});

it("offers no way to change who is in the channel to someone who may not", async () => {
  await render({ people: { restricted: true, userIds: ["u-pedro", "u-marta"], canManage: false } });
  expect(host!.textContent).not.toContain("Add people or agents");
  expect(host!.querySelector('button[aria-label^="Remove"]')).toBeNull();
});

it("lets a manager remove anyone but themselves and the owner", async () => {
  const handlers = await render({
    currentUserId: "u-joao",
    people: { restricted: true, userIds: ["u-pedro", "u-joao", "u-marta"], canManage: true },
  });
  expect(host!.textContent).toContain("Add people or agents");
  const remove = [...host!.querySelectorAll<HTMLButtonElement>('button[aria-label^="Remove"]')];
  expect(remove.map((button) => button.getAttribute("aria-label"))).toEqual(["Remove Marta"]);
  await act(async () => remove[0]!.click());
  expect(handlers.onRemovePerson).toHaveBeenCalledWith("u-marta");
});

it("closes from its own button", async () => {
  const handlers = await render();
  await act(async () =>
    host!.querySelector<HTMLButtonElement>('button[aria-label="Close panel"]')!.click(),
  );
  expect(handlers.onClose).toHaveBeenCalled();
});
