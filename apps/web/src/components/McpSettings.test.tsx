// @vitest-environment jsdom
import type { McpAccessKey } from "@corvo/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { rpc } from "../lib/rpc";
import { McpSettings } from "./McpSettings";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
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
    ...props
  }: {
    children: ReactNode;
    confirmLabel: string;
    onConfirm: () => void;
  } & ComponentProps<"button">) => (
    <button
      type="button"
      data-confirm={confirmLabel}
      aria-label={props["aria-label"]}
      onClick={onConfirm}
    >
      {children}
    </button>
  ),
  OptionSelect: ({
    value,
    options,
    onValueChange,
    "aria-label": label,
  }: {
    value: string;
    options: Array<{ value: string; label: string }>;
    onValueChange: (value: string) => void;
    "aria-label"?: string;
  }) => (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("../lib/rpc", () => ({
  rpc: { mcpAccess: { list: vi.fn(), create: vi.fn(), revoke: vi.fn() } },
}));
vi.mock("../lib/relative-time", () => ({ formatRelativeTime: () => "2h ago" }));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const key = (overrides: Partial<McpAccessKey> = {}): McpAccessKey => ({
  id: "key-1",
  name: "laptop",
  level: "talk",
  spaceId: null,
  spaceName: null,
  prefix: "rk_abcd",
  createdAt: "2026-02-01T00:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const spaces = [
  { id: "space-a", name: "Home" },
  { id: "space-b", name: "Work" },
];

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

it("lists live keys with their access, space and last use, and hides revoked ones", async () => {
  vi.mocked(rpc.mcpAccess.list).mockResolvedValue([
    key({ lastUsedAt: "2026-02-01T00:00:00.000Z", spaceName: "Work" }),
    key({ id: "key-2", name: "old", revokedAt: "2026-02-01T00:00:00.000Z" }),
  ]);
  await act(async () => root.render(<McpSettings spaces={spaces} />));
  const items = host.querySelectorAll("li");
  expect(items).toHaveLength(1);
  expect(items[0]?.textContent).toContain("laptop");
  expect(items[0]?.textContent).toContain("Talk · Work · 2h ago");
});

it("shows the server URL and the add command with a placeholder until a key exists", async () => {
  vi.mocked(rpc.mcpAccess.list).mockResolvedValue([]);
  await act(async () => root.render(<McpSettings spaces={spaces} />));
  expect(host.querySelector('[data-testid="mcp-url"]')?.textContent).toBe(
    `${window.location.origin}/mcp`,
  );
  expect(host.textContent).toContain(
    `claude mcp add --transport http rook ${window.location.origin}/mcp --header "Authorization: Bearer <key>"`,
  );
});

it("shows the new key once, fills the command with it, and forgets it on Done", async () => {
  vi.mocked(rpc.mcpAccess.list).mockResolvedValue([]);
  vi.mocked(rpc.mcpAccess.create).mockResolvedValue({ key: key(), secret: "rk_secret-value" });
  await act(async () => root.render(<McpSettings spaces={spaces} />));
  await act(async () => typeInto(host.querySelector("input") as HTMLInputElement, " laptop "));
  const level = host.querySelector('select[aria-label="Access"]') as HTMLSelectElement;
  await act(async () => {
    level.value = "configure";
    level.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const space = host.querySelector('select[aria-label="Space"]') as HTMLSelectElement;
  await act(async () => {
    space.value = "space-b";
    space.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    host
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(rpc.mcpAccess.create).toHaveBeenCalledWith({
    name: "laptop",
    level: "configure",
    spaceId: "space-b",
  });
  expect(host.querySelector('[data-testid="mcp-secret"]')?.textContent).toBe("rk_secret-value");
  expect(host.textContent).toContain("Bearer rk_secret-value");
  const done = [...host.querySelectorAll("button")].find((button) => button.textContent === "Done");
  await act(async () => done?.click());
  expect(host.textContent).not.toContain("rk_secret-value");
});

it("offers a space only when there is more than one", async () => {
  vi.mocked(rpc.mcpAccess.list).mockResolvedValue([]);
  await act(async () => root.render(<McpSettings spaces={[spaces[0] as never]} />));
  expect(host.querySelector('select[aria-label="Space"]')).toBeNull();
});

it("revokes a key through the inline confirmation", async () => {
  vi.mocked(rpc.mcpAccess.list).mockResolvedValue([key()]);
  vi.mocked(rpc.mcpAccess.revoke).mockResolvedValue({ ok: true });
  await act(async () => root.render(<McpSettings spaces={spaces} />));
  const revoke = host.querySelector<HTMLButtonElement>('[data-confirm="Confirm revoke?"]');
  await act(async () => revoke?.click());
  expect(rpc.mcpAccess.revoke).toHaveBeenCalledWith({ keyId: "key-1" });
  expect(host.querySelectorAll("li")).toHaveLength(0);
});

it("reports a failed load with a retry", async () => {
  vi.mocked(rpc.mcpAccess.list)
    .mockRejectedValueOnce(new Error("down"))
    .mockResolvedValueOnce([key()]);
  await act(async () => root.render(<McpSettings spaces={spaces} />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not load");
  const retry = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Retry",
  );
  await act(async () => retry?.click());
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelectorAll("li")).toHaveLength(1);
});
