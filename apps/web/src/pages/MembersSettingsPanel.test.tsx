// @vitest-environment jsdom
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MembersSettingsPanel } from "./MembersSettingsPanel";

const spaces = vi.hoisted(() => ({
  members: { list: vi.fn(), setRole: vi.fn(), remove: vi.fn(), leave: vi.fn() },
  invitations: { list: vi.fn(), create: vi.fn(), resend: vi.fn(), cancel: vi.fn() },
  inviteLink: { get: vi.fn(), create: vi.fn(), disable: vi.fn() },
  joinRequests: { list: vi.fn(), answer: vi.fn() },
}));
vi.mock("../lib/rpc", () => ({ rpc: { spaces } }));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, part, index) => text + part + String(values[index] ?? ""), ""),
  }),
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
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: ComponentProps<"button">) => (
    <button type="button">{children}</button>
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
  for (const group of Object.values(spaces))
    for (const fn of Object.values(group)) fn.mockResolvedValue({ ok: true });
  spaces.invitations.list.mockResolvedValue([]);
  spaces.joinRequests.list.mockResolvedValue([]);
  spaces.inviteLink.get.mockResolvedValue({ link: null });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(userId: string) {
  await act(async () => {
    root.render(<MembersSettingsPanel userId={userId} />);
  });
}

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
