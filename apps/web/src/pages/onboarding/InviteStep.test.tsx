// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("../../lib/rpc", () => ({ rpc: { spaces: { invitations: { create } } } }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

import { InviteStep } from "./InviteStep";

const onDone = vi.fn();
let container: HTMLDivElement;
let root: Root;

const button = (name: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === name,
  ) as HTMLButtonElement;

async function type(value: string) {
  const area = container.querySelector("textarea") as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  create.mockReset().mockResolvedValue({ emailed: true, invitations: [] });
  onDone.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<InviteStep onDone={onDone} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("InviteStep", () => {
  it("invites every pasted address as a member, then moves on", async () => {
    await type("ana@example.com, bruno@example.com\ncarla@example.com");
    await act(async () => button("Invite").click());
    expect(create).toHaveBeenCalledWith({
      addresses: "ana@example.com\nbruno@example.com\ncarla@example.com",
      role: "member",
      roleIds: [],
    });
    expect(onDone).toHaveBeenCalled();
  });

  it("does not invite until there is a valid address, and skipping sends nothing", async () => {
    expect(button("Invite").disabled).toBe(true);
    await type("not-an-email");
    expect(button("Invite").disabled).toBe(true);
    await act(async () => button("Skip").click());
    expect(create).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it("stays on the step when sending fails", async () => {
    create.mockRejectedValue(new Error("nope"));
    await type("ana@example.com");
    await act(async () => button("Invite").click());
    expect(onDone).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
