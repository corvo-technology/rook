// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@corvo/ui-web", () => ({
  RookGlyph: () => <svg data-testid="rook-glyph" />,
}));

import { setBrandForTest } from "../lib/brand";
import { BrandGlyph } from "./BrandGlyph";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const brand = {
  name: "Acme",
  accent: null,
  logoUrl: null,
  iconUrl: "/api/brand/assets/p1/icon-abc.png",
  supportEmail: null,
  termsUrl: null,
  privacyUrl: null,
};

async function html() {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<BrandGlyph state="loading" size={28} />));
  const out = container.innerHTML;
  await act(async () => root.unmount());
  return out;
}

afterEach(() => setBrandForTest(null));

it("is the app's mark on the app's own host", async () => {
  expect(await html()).toContain("rook-glyph");
});

it("is the partner's icon on a partner host, and never Rook's mark", async () => {
  setBrandForTest(brand);
  const out = await html();
  expect(out).toContain("/api/brand/assets/p1/icon-abc.png");
  expect(out).not.toContain("rook-glyph");
});

it("is a neutral dot when the partner has no icon", async () => {
  setBrandForTest({ ...brand, iconUrl: null });
  const out = await html();
  expect(out).not.toContain("rook-glyph");
  expect(out).not.toContain("<img");
  expect(out).toContain("animate-pulse");
});
