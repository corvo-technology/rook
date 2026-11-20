// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, index) => text + part + String(values[index] ?? ""), ""),
  }),
}));
vi.mock("../partner/PartnerConsolePage", () => ({
  usePartnerSectionTitle: () => (section: string) => section,
}));
vi.mock("../../lib/partner-console", () => ({
  partnerPath: (id: string, section: string) => `/app/partner/${id}/${section}`,
  sectionsFor: () => ["overview", "customers"],
  usePartners: () => ({ data: [{ id: "p1", name: "Acme", mode: "reseller" }] }),
}));

import { SidebarPartnership } from "./sidebar-partner";

async function render(path: string, open: boolean) {
  const onToggle = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <SidebarPartnership open={open} onToggle={onToggle} onOpen={vi.fn()} />
      </MemoryRouter>,
    ),
  );
  const links = () => host.querySelectorAll('[data-testid^="sidebar-partner-"]').length;
  const trigger = () => host.querySelector("h2 button") as HTMLButtonElement;
  return { links, trigger, onToggle, cleanup: () => act(async () => root.unmount()) };
}

it("stays folded off the partner pages until the person opens it", async () => {
  const folded = await render("/app", false);
  expect(folded.links()).toBe(0);
  expect(folded.trigger().getAttribute("aria-label")).toBe("Expand Partnership");
  await act(async () => folded.trigger().click());
  expect(folded.onToggle).toHaveBeenCalledOnce();
  await folded.cleanup();
  const opened = await render("/app", true);
  expect(opened.links()).toBe(2);
  expect(opened.trigger().getAttribute("aria-label")).toBe("Collapse Partnership");
  await opened.cleanup();
});

it("opens by itself on a partner page", async () => {
  const inside = await render("/app/partner/p1/customers", false);
  expect(inside.links()).toBe(2);
  await inside.cleanup();
});
