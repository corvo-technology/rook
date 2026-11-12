// @vitest-environment jsdom
import { act } from "react";
import { expect, it, vi } from "vitest";
import { SidePanel } from "./side-panel.js";
import { key, mount } from "./test-render.js";

it("renders nothing while closed and a named, non-modal landmark while open", async () => {
  const view = await mount(
    <SidePanel open={false} onClose={() => {}} title="New routine" closeLabel="Close">
      body
    </SidePanel>,
  );
  expect(document.querySelector("aside")).toBeNull();
  await view.rerender(
    <SidePanel open onClose={() => {}} title="New routine" closeLabel="Close">
      body
    </SidePanel>,
  );
  const panel = document.querySelector("aside")!;
  expect(panel.getAttribute("aria-labelledby")).toBe(panel.querySelector("h2")?.id);
  expect(panel.getAttribute("aria-modal")).toBeNull();
  expect(document.activeElement).toBe(panel);
  await view.cleanup();
});

it("focuses the field that asks for it and gives focus back on close", async () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const view = await mount(
    <SidePanel open onClose={() => {}} title="T" closeLabel="Close">
      <input data-autofocus />
    </SidePanel>,
  );
  expect(document.activeElement).toBe(document.querySelector("input"));
  await view.cleanup();
  expect(document.activeElement).toBe(opener);
  opener.remove();
});

it("closes on Esc from inside the panel or from nowhere, but not from another field or an open menu", async () => {
  const onClose = vi.fn();
  const outside = document.createElement("input");
  document.body.append(outside);
  const view = await mount(
    <SidePanel open onClose={onClose} title="T" closeLabel="Close">
      <input />
    </SidePanel>,
  );
  await key(outside, "Escape");
  expect(onClose).not.toHaveBeenCalled();
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  document.body.append(menu);
  await key(document.querySelector("aside input")!, "Escape");
  expect(onClose).not.toHaveBeenCalled();
  menu.remove();
  await key(document.querySelector("aside input")!, "Escape");
  expect(onClose).toHaveBeenCalledTimes(1);
  await key(document.body, "Escape");
  expect(onClose).toHaveBeenCalledTimes(2);
  await view.cleanup();
  outside.remove();
});

it("pins the footer and closes from the close control", async () => {
  const onClose = vi.fn();
  const view = await mount(
    <SidePanel
      open
      onClose={onClose}
      title="T"
      closeLabel="Close"
      footer={<button type="button">Save</button>}
    >
      body
    </SidePanel>,
  );
  expect(document.querySelector("footer")?.textContent).toBe("Save");
  await act(async () =>
    document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click(),
  );
  expect(onClose).toHaveBeenCalled();
  await view.cleanup();
});
