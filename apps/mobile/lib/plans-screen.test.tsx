// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Plans from "../app/(settings)/plans";
import { rpc } from "./api";

const GIB = 1024 ** 3;
const { state } = vi.hoisted(() => ({
  state: { locale: "pt-BR", openURL: vi.fn(async (_url: string) => undefined) },
}));

const plans = [
  {
    plan: "personal",
    computerSize: "small",
    computers: 1,
    storageBytes: 25 * GIB,
    seatsIncluded: 1,
    maxSeats: 1,
  },
  {
    plan: "team",
    computerSize: "medium",
    computers: 1,
    storageBytes: 50 * GIB,
    seatsIncluded: 10,
    maxSeats: 15,
  },
  {
    plan: "company",
    computerSize: "large",
    computers: 1,
    storageBytes: 200 * GIB,
    seatsIncluded: 25,
    maxSeats: 50,
  },
];

vi.mock("react-native", () => ({
  ActivityIndicator: () => createElement("span", { role: "progressbar" }),
  Alert: { alert: vi.fn() },
  Linking: { openURL: (url: string) => state.openURL(url) },
  ScrollView: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}));
vi.mock("@expo/ui/community/menu", () => ({
  MenuView: ({
    actions,
    onPressAction,
    children,
  }: {
    actions: { id: string; title: string }[];
    onPressAction: (event: { nativeEvent: { event: string } }) => void;
    children?: ReactNode;
  }) =>
    createElement(
      "div",
      null,
      children,
      ...actions.map((action) =>
        createElement(
          "button",
          {
            type: "button",
            key: action.id,
            "data-menu": action.id,
            onClick: () => onPressAction({ nativeEvent: { event: action.id } }),
          },
          action.title,
        ),
      ),
    ),
}));
vi.mock("../components/settings-group", () => ({
  SettingsGroup: ({ children, footer }: { children?: ReactNode; footer?: string }) =>
    createElement("section", null, children, footer ? createElement("p", null, footer) : null),
  SettingsRow: ({
    title,
    value,
    disabled,
    onPress,
  }: {
    title: string;
    value?: string;
    disabled?: boolean;
    onPress?: () => void;
  }) =>
    createElement(
      "button",
      { type: "button", "data-row": title, disabled, onClick: onPress },
      title,
      value ? ` ${value}` : null,
    ),
  SettingsSwitch: ({
    label,
    onChange,
    value,
  }: {
    label: string;
    value: boolean;
    onChange: (v: boolean) => void;
  }) =>
    createElement(
      "button",
      { type: "button", "data-switch": label, onClick: () => onChange(!value) },
      label,
    ),
}));
vi.mock("./side-insets", () => ({ useSideInsets: () => ({}) }));
vi.mock("./api", () => ({
  rpc: vi.fn(async (method: string) => {
    if (method === "usage/plan") {
      return {
        plan: "personal",
        computerSize: "small",
        computers: { used: 0, limit: 1 },
        storage: { usedBytes: 0, limitBytes: 25 * 1024 ** 3 },
        seats: { used: 1, included: 1, max: 1, extraPrice: null },
        plans,
        canManage: true,
      };
    }
    return { url: "https://checkout.example.test/session" };
  }),
}));
vi.mock("./i18n", () => {
  // Stable across renders, as the real module's translate function is.
  const t = (text: string, values?: Record<string, string | number>) =>
    text.replace(/\{(\w+)\}/g, (match, key: string) =>
      values && key in values ? String(values[key]) : match,
    );
  return {
    dateLocaleForUi: () => state.locale,
    useI18n: () => ({ locale: state.locale, t }),
  };
});

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const text = () => (host.textContent ?? "").replace(/ /g, " ");
const click = (selector: string) =>
  act(async () => {
    (host.querySelector(selector) as HTMLElement).click();
  });

it("lists the three plans in reais for pt-BR and opens the chosen plan's checkout", async () => {
  await act(async () => root.render(createElement(Plans)));
  for (const plan of ["personal", "team", "company"]) {
    expect(host.querySelector(`[data-menu="${plan}"]`)).not.toBeNull();
  }
  expect(text()).toContain("R$ 307,80/month");

  await click('[data-menu="team"]');
  await click('[data-menu="year"]');
  await click('[data-row^="Subscribe to"]');

  expect(rpc).toHaveBeenCalledWith("billing/planCheckout", {
    plan: "team",
    interval: "year",
    currency: "brl",
    aiUseCents: 1000,
  });
  expect(state.openURL).toHaveBeenCalledWith("https://checkout.example.test/session");
});

it("sends no AI amount when AI is switched off", async () => {
  state.locale = "en";
  await act(async () => root.render(createElement(Plans)));
  await click('[data-switch="Include AI"]');
  await click('[data-row^="Subscribe to"]');
  expect(rpc).toHaveBeenLastCalledWith("billing/planCheckout", {
    plan: "team",
    interval: "month",
    currency: "usd",
    aiUseCents: null,
  });
});
