import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
}));
vi.mock("../../lib/rpc", () => ({ rpc: {} }));

import { PartnerBalanceLine } from "./PartnerBalance";

const balance = {
  currency: "BRL",
  planCredit: 3000,
  used: 1200,
  remaining: 1800,
  periodEnd: null,
  state: "active",
  checkoutUrl: "https://pay.example.test/buy",
  lowThresholdReached: false,
};
const html = (value: typeof balance | null) =>
  renderToString(<PartnerBalanceLine balance={value} locale="pt-BR" />).replace(/&nbsp;| /g, " ");

it("renders nothing when the server offers no balance", () => {
  expect(html(null)).toBe("");
});

it("shows what is left of the month, with the way to buy more", () => {
  const out = html(balance);
  expect(out).toContain('data-state="normal"');
  expect(out).toContain("R$ 18 of R$ 30 this month");
  expect(out).toContain("Buy more");
  expect(out).not.toContain("partner-balance-note");
});

it("warns near the end, when used up, and when the plan lapsed", () => {
  const low = html({ ...balance, remaining: 500, lowThresholdReached: true });
  expect(low).toContain('data-state="low"');
  expect(low).toContain("Running low");
  expect(html({ ...balance, remaining: 0 })).toContain("Used up");
  expect(html({ ...balance, state: "lapsed" })).toContain("Plan inactive");
});

it("has no buy button when the partner set no checkout", () => {
  expect(html({ ...balance, checkoutUrl: null })).not.toContain("Buy more");
});
