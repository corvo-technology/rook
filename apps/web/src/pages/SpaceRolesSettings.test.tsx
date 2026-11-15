// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SpaceRolesSettings } from "./SpaceRolesSettings";

const rpc = vi.hoisted(() => ({
  spaces: {
    roles: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn() },
    members: { list: vi.fn(), setRoles: vi.fn() },
  },
}));
vi.mock("../lib/space-rpc", () => ({ useSpaceRpc: () => rpc }));
vi.mock("../lib/user-error", () => ({ errorText: (error: unknown) => String(error) }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@lingui/core/macro", () => ({
  plural: (value: number, forms: { one: string; other: string }) =>
    (value === 1 ? forms.one : forms.other).replace("#", String(value)),
}));
vi.mock("@corvo/ui-web", () => ({
  Button: ({
    size: _size,
    variant: _variant,
    ...props
  }: ComponentProps<"button"> & Record<string, unknown>) => <button type="button" {...props} />,
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
  Switch: ({
    checked,
    disabled,
    onCheckedChange,
  }: {
    checked: boolean;
    disabled?: boolean;
    onCheckedChange: (on: boolean) => void;
  }) => (
    <input
      type="checkbox"
      role="switch"
      aria-checked={checked}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}));

const role = (
  id: string,
  name: string,
  position: number,
  keys: string[],
  systemKey: "admin" | "everyone" | null = null,
) => ({
  id,
  name,
  color: null,
  position,
  keys,
  systemKey,
  memberCount: 0,
});
const roles = [
  role("admin", "Admin", 0, ["manage_roles", "post"], "admin"),
  role("ops", "Ops", 1, ["view_usage"]),
  role("everyone", "Everyone", 2147483647, ["post"], "everyone"),
];

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.clearAllMocks();
  rpc.spaces.members.list.mockResolvedValue([]);
  rpc.spaces.roles.update.mockResolvedValue({ ok: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const mount = async (me: { isOwner: boolean; roleIds: string[]; permissions: string[] }) => {
  rpc.spaces.roles.list.mockResolvedValue({ roles, me });
  await act(async () => {
    root.render(<SpaceRolesSettings />);
  });
};

it("shows nothing to someone who does not manage roles", async () => {
  await mount({ isOwner: false, roleIds: [], permissions: ["post"] });
  expect(host.textContent).toBe("");
});

it("lists the roles with a one-line summary and saves a switch as soon as it moves", async () => {
  await mount({ isOwner: true, roleIds: [], permissions: [] });
  expect(host.textContent).toContain("Ops");
  expect(host.textContent).toContain("1 permission");
  const opsRow = [...host.querySelectorAll("button[aria-expanded]")].find((node) =>
    node.textContent?.includes("Ops"),
  );
  await act(async () => {
    (opsRow as HTMLElement).click();
  });
  const switches = [...host.querySelectorAll('input[role="switch"]')] as HTMLInputElement[];
  // Administrator, then the keys in order: the first key is "Post messages".
  await act(async () => {
    switches[1]?.click();
  });
  expect(rpc.spaces.roles.update).toHaveBeenCalledWith({ id: "ops", keys: ["view_usage", "post"] });
});
