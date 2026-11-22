// @vitest-environment jsdom
import { act } from "react";
import { expect, it, vi } from "vitest";
import { SettingsLayout } from "./settings-layout.js";
import { key, mount } from "./test-render.js";

const sections = [
  { id: "general", label: "General" },
  { id: "approvals", label: "Approvals" },
];

it("marks the active section, titles the page with it and navigates per section", async () => {
  const onSelect = vi.fn();
  const onBack = vi.fn();
  const view = await mount(
    <SettingsLayout
      title="Settings"
      onBack={onBack}
      sections={sections}
      activeId="approvals"
      onSelect={onSelect}
    >
      content
    </SettingsLayout>,
  );
  expect(view.host.querySelector("h1")?.textContent).toBe("Approvals");
  expect(view.host.querySelector('[aria-current="page"]')?.textContent).toBe("Approvals");
  await act(async () =>
    view.host.querySelector<HTMLElement>('[data-testid="settings-nav-general"]')?.click(),
  );
  expect(onSelect).toHaveBeenCalledWith("general");
  await act(async () =>
    view.host.querySelector<HTMLElement>('[data-testid="settings-back"]')?.click(),
  );
  expect(onBack).toHaveBeenCalledTimes(1);
  await view.cleanup();
});

it("goes back on Esc, except while typing or with a menu open", async () => {
  const onBack = vi.fn();
  const view = await mount(
    <SettingsLayout
      title="Settings"
      onBack={onBack}
      sections={sections}
      activeId="general"
      onSelect={() => {}}
    >
      <input />
    </SettingsLayout>,
  );
  await key(view.host.querySelector("input")!, "Escape");
  expect(onBack).not.toHaveBeenCalled();
  await key(document.body, "Escape");
  expect(onBack).toHaveBeenCalledTimes(1);
  await view.cleanup();
});

it("keeps advanced sections in a group that starts closed and remembers it was opened", async () => {
  window.localStorage.removeItem("corvo:settings-advanced-open");
  const grouped = [...sections, { id: "models", label: "Models", advanced: true }];
  const render = () =>
    mount(
      <SettingsLayout
        title="Settings"
        onBack={vi.fn()}
        sections={grouped}
        activeId="general"
        onSelect={vi.fn()}
        advancedLabel="Advanced"
      >
        content
      </SettingsLayout>,
    );
  const first = await render();
  const toggle = () =>
    first.host.querySelector<HTMLElement>('[data-testid="settings-nav-advanced"]');
  expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
  expect(first.host.querySelector('[data-testid="settings-nav-models"]')).toBeNull();
  await act(async () => toggle()?.click());
  expect(first.host.querySelector('[data-testid="settings-nav-models"]')).not.toBeNull();
  await first.cleanup();
  const second = await render();
  expect(second.host.querySelector('[data-testid="settings-nav-models"]')).not.toBeNull();
  await second.cleanup();
  window.localStorage.removeItem("corvo:settings-advanced-open");
});
