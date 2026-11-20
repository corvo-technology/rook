// @vitest-environment jsdom
import { DEFAULT_PLANS } from "@corvo/contracts";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlanCardsProps } from "./plan-cards.js";
import { PlanCards } from "./plan-cards.js";
import { mount } from "./test-render.js";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const plans = Object.values(DEFAULT_PLANS).map(({ extraSeatPriceId: _price, ...plan }) => plan);
const names = { personal: "Personal", team: "Team", company: "Company" };

const labels: PlanCardsProps["labels"] = {
  monthly: "Monthly",
  yearly: "Yearly",
  twoMonthsFree: "2 months free",
  currency: "Currency",
  interval: "Billing period",
  recommended: "Recommended",
  perMonth: "/month",
  planName: (plan) => names[plan],
  forWhom: (plan) => `for ${plan}`,
  serverAndAi: (server, ai) => `Server ${server} + AI ${ai}`,
  yearlyTotal: (total, saved) => `${total} a year, ${saved} saved`,
  subscribe: (plan) => `Subscribe to ${names[plan]}`,
  computer: (size) => `${size} computer`,
  computerSpec: (size) => `spec ${size}`,
  people: (count) => `${count} people`,
  extraPeople: (price, max) => `${price} each, up to ${max}`,
  files: (bytes) => `${Math.round(bytes / 1024 ** 3)} GB of files`,
  bots: "Bots and browser",
  routines: "Scheduled routines",
  includeAi: "Include AI",
  aiAmount: "AI per month",
  aiPerMonth: (price) => `${price}/month`,
  aiToModels: (amount) => `${amount} goes to models`,
  ownAi: "Use the AI you already pay for",
  reassurance: "Ready in minutes · cancel anytime",
  ownerOnly: "Only the owner can subscribe",
};

async function render(props: Partial<PlanCardsProps> = {}) {
  const onSubscribe = vi.fn();
  const view = await mount(
    <PlanCards
      plans={plans}
      locale="pt-BR"
      canManage
      pending={false}
      labels={labels}
      onSubscribe={onSubscribe}
      {...props}
    />,
  );
  const text = () => (view.host.textContent ?? "").replace(/ /g, " ");
  const click = (el: Element | null | undefined) => {
    if (!el) throw new Error("missing element");
    return act(async () => {
      (el as HTMLElement).click();
    });
  };
  const card = (name: string) => view.host.querySelector(`[data-plan="${name}"]`) as HTMLElement;
  const aiSwitch = (name: string) => card(name).querySelector('[role="switch"]') as HTMLElement;
  const byText = (value: string) =>
    [...view.host.querySelectorAll("button")].find((b) => b.textContent?.startsWith(value));
  return { ...view, onSubscribe, text, click, card, aiSwitch, byText };
}

it("shows reais in pt-BR and dollars elsewhere, with the server and AI added up", async () => {
  const br = await render();
  expect(br.card("team").textContent?.replace(/ /g, " ")).toContain("R$ 307,80");
  expect(br.card("team").textContent?.replace(/ /g, " ")).toContain(
    "Server R$ 235,90 + AI R$ 71,90",
  );
  await br.cleanup();
  const en = await render({ locale: "en" });
  expect(en.card("team").textContent).toContain("$51");
  expect(en.card("team").textContent).toContain("Server $39 + AI $12");
  await en.cleanup();
});

it("drops the AI part of the price when AI is off", async () => {
  const en = await render({ locale: "en" });
  await en.click(en.aiSwitch("team"));
  const team = en.card("team").textContent ?? "";
  expect(team).toContain("$39");
  expect(team).not.toContain("Server");
  expect(team).toContain("Use the AI you already pay for");
  expect(en.card("personal").textContent).toContain("Server $15 + AI $12");
  await en.cleanup();
});

it("shows the year price divided by twelve with the yearly total and saving", async () => {
  const en = await render({ locale: "en" });
  await en.click(en.aiSwitch("team"));
  await en.click(en.byText("Yearly"));
  const team = en.card("team").textContent ?? "";
  expect(team).toContain("$32.50");
  expect(team).toContain("$390 a year, $78 saved");
  await en.cleanup();
});

it("keeps the AI choice when the interval changes", async () => {
  const en = await render({ locale: "en" });
  await en.click(en.aiSwitch("team"));
  await en.click(en.byText("Yearly"));
  await en.click(en.byText("Monthly"));
  expect(en.card("team").textContent).not.toContain("Server");
  await en.cleanup();
});

it("subscribes to the chosen plan, interval, currency and AI amount", async () => {
  const br = await render();
  await br.click(br.byText("Yearly"));
  await br.click(br.card("team").querySelector("[data-subscribe]"));
  expect(br.onSubscribe).toHaveBeenCalledWith({
    plan: "team",
    interval: "year",
    currency: "brl",
    aiUseCents: 1000,
  });
  await br.cleanup();
});

it("subscribes without AI as null", async () => {
  const en = await render({ locale: "en" });
  await en.click(en.aiSwitch("company"));
  await en.click(en.card("company").querySelector("[data-subscribe]"));
  expect(en.onSubscribe).toHaveBeenCalledWith({
    plan: "company",
    interval: "month",
    currency: "usd",
    aiUseCents: null,
  });
  await en.cleanup();
});

it("lets the person switch currency", async () => {
  const en = await render({ locale: "en" });
  await en.click(en.byText("BRL"));
  expect(en.text()).toContain("R$");
  await en.click(en.card("team").querySelector("[data-subscribe]"));
  expect(en.onSubscribe).toHaveBeenCalledWith(expect.objectContaining({ currency: "brl" }));
  await en.cleanup();
});

it("disables subscribing for a member who cannot manage billing and says why once", async () => {
  const en = await render({ locale: "en", canManage: false });
  for (const button of en.host.querySelectorAll("[data-subscribe]")) {
    expect((button as HTMLButtonElement).disabled).toBe(true);
  }
  expect(en.text().split("Only the owner can subscribe")).toHaveLength(2);
  await en.cleanup();
});

it("says the reassurance once, below the cards, and marks Team as recommended", async () => {
  const en = await render({ locale: "en" });
  expect(en.text().split("Ready in minutes").length).toBe(2);
  expect(en.card("team").textContent).toContain("Recommended");
  expect(en.card("personal").textContent).not.toContain("Recommended");
  await en.cleanup();
});

it("gives no yearly discount on AI: the saving counts only the server's free months", async () => {
  const en = await render({ locale: "en" });
  await en.click(en.byText("Yearly"));
  const team = en.card("team").textContent ?? "";
  expect(team).toContain("$44.50");
  expect(team).toContain("Server $32.50 + AI $12");
  expect(team).toContain("$534 a year, $78 saved");
  await en.cleanup();
});
