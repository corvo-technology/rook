// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@corvo/ui-web", () => ({
  BotAvatar: () => <span data-testid="avatar" />,
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));

import { setBrandForTest } from "../lib/brand";
import { AuthFrame } from "./AuthFrame";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(onSubmit = vi.fn()) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <AuthFrame title="Sign in" onSubmit={onSubmit}>
        <button type="submit">Continue</button>
      </AuthFrame>,
    ),
  );
  return {
    container,
    onSubmit,
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

it("titles the page and keeps the form's own content and submit", async () => {
  const { container, onSubmit, cleanup } = await render();
  expect(container.querySelector("h1")?.textContent).toBe("Sign in");
  await act(async () => container.querySelector<HTMLButtonElement>("button[type=submit]")?.click());
  expect(onSubmit).toHaveBeenCalledTimes(1);
  await cleanup();
});

it("signs the page with Ana and the name, not an icon on a dark tile", async () => {
  const { container, cleanup } = await render();
  const brand = container.querySelector("[data-testid='auth-brand']");
  expect(brand?.textContent).toBe("Rook");
  expect(brand?.querySelectorAll("[data-testid=avatar]")).toHaveLength(1);
  expect(container.innerHTML).not.toContain("gradient");
  await cleanup();
});

it("tells wide screens what the product does, beside the form and not over it", async () => {
  const { container, cleanup } = await render();
  const panel = container.querySelector("[data-testid='auth-team']");
  expect(panel?.textContent).toContain("Bots that handle your inbox and invoices");
  expect(panel?.className).toContain("hidden");
  expect(panel?.className).toContain("lg:flex");
  // The baby crows are decoration: they add nothing a screen reader needs.
  const crows = panel?.querySelectorAll("[data-testid=avatar]") ?? [];
  expect(crows).toHaveLength(3);
  for (const crow of crows) expect(crow.parentElement?.getAttribute("aria-hidden")).toBe("true");
  expect(container.querySelector("form")?.contains(panel ?? null)).toBe(false);
  await cleanup();
});

it("wears the partner's brand: its logo and name, no Rook and no team beside the form", async () => {
  setBrandForTest({
    name: "Acme",
    accent: null,
    logoUrl: "/api/brand/assets/p1/logo-abc.png",
    iconUrl: null,
    supportEmail: null,
    termsUrl: null,
    privacyUrl: null,
  });
  try {
    const { container, cleanup } = await render();
    const brand = container.querySelector("[data-testid='auth-brand']");
    expect(brand?.textContent).toBe("Acme");
    expect(brand?.querySelector("img")?.getAttribute("src")).toBe(
      "/api/brand/assets/p1/logo-abc.png",
    );
    expect(container.querySelector("[data-testid=auth-team]")).toBeNull();
    expect(container.querySelector("[data-testid=avatar]")).toBeNull();
    expect(container.textContent).not.toContain("Rook");
    await cleanup();
  } finally {
    setBrandForTest(null);
  }
});
