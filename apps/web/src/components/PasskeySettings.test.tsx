// @vitest-environment jsdom
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authClient } from "../lib/auth";
import type * as Passkeys from "../lib/passkeys";
import { PasskeySettings } from "./PasskeySettings";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@corvo/ui-web", () => {
  return {
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
      <button type="button" data-confirm={confirmLabel} aria-label="Delete" onClick={onConfirm}>
        {children}
      </button>
    ),
  };
});
vi.mock("../lib/auth", () => ({
  authClient: {
    passkey: {
      listUserPasskeys: vi.fn(),
      addPasskey: vi.fn(),
      updatePasskey: vi.fn(),
      deletePasskey: vi.fn(),
    },
  },
}));
vi.mock("../lib/passkeys", async (importActual) => ({
  ...(await importActual<typeof Passkeys>()),
  usePasskeysSupported: () => true,
}));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

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

function buttonNamed(label: string) {
  return [...host.querySelectorAll("button")].find((button) => button.textContent === label);
}

it("reports a failed load with a retry instead of an empty list", async () => {
  vi.mocked(authClient.passkey.listUserPasskeys)
    .mockResolvedValueOnce({ data: null, error: { status: 500 } } as never)
    .mockResolvedValueOnce({
      data: [{ id: "passkey-1", name: "Laptop", createdAt: new Date().toISOString() }],
      error: null,
    } as never);
  await act(async () => root.render(<PasskeySettings />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not load");

  await act(async () => buttonNamed("Retry")?.click());
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector("li")?.textContent).toContain("Laptop");
});

it("reloads after adding a passkey", async () => {
  vi.mocked(authClient.passkey.listUserPasskeys)
    .mockResolvedValueOnce({ data: [], error: null } as never)
    .mockResolvedValueOnce({
      data: [{ id: "passkey-1", name: null, createdAt: new Date().toISOString() }],
      error: null,
    } as never);
  vi.mocked(authClient.passkey.addPasskey).mockResolvedValue({
    data: { id: "passkey-1" },
    error: null,
  } as never);
  await act(async () => root.render(<PasskeySettings />));
  expect(host.querySelectorAll("li")).toHaveLength(0);
  await act(async () => buttonNamed("Add passkey")?.click());
  expect(host.querySelectorAll("li")).toHaveLength(1);
});

it("deletes a passkey through the inline confirmation, without a dialog", async () => {
  vi.mocked(authClient.passkey.listUserPasskeys).mockResolvedValue({
    data: [{ id: "passkey-1", name: "Laptop", createdAt: new Date().toISOString() }],
    error: null,
  } as never);
  vi.mocked(authClient.passkey.deletePasskey).mockResolvedValue({ data: {}, error: null } as never);
  await act(async () => root.render(<PasskeySettings />));
  const remove = host.querySelector<HTMLButtonElement>('[data-confirm="Confirm delete?"]');
  await act(async () => remove?.click());
  expect(authClient.passkey.deletePasskey).toHaveBeenCalledWith({ id: "passkey-1" });
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});
