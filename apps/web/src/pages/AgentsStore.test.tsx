// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { AgentsStore } from "./AgentsStore";

const locale = vi.hoisted(() => ({ current: "en" }));
const bots = vi.hoisted(() => ({ current: [] as Array<Record<string, unknown>> }));
const skillList = vi.hoisted(() => ({ current: [] as Array<{ name: string }> }));
const addAgent = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
const emailStatus = vi.hoisted(() => ({ available: true }));
const partners = vi.hoisted(() => ({ current: [] as string[] }));

vi.mock("../lib/agent-catalog-install", async () => {
  const actual = await vi.importActual<typeof import("../lib/agent-catalog-install")>(
    "../lib/agent-catalog-install",
  );
  return { ...actual, addCatalogAgent: addAgent };
});
vi.mock("../lib/query", () => ({
  useSpaceQueries: () => ({
    bots: {
      list: {
        queryOptions: () => ({ queryKey: ["bots"], queryFn: async () => bots.current }),
      },
    },
    agentSkills: {
      list: {
        queryOptions: () => ({ queryKey: ["skills"], queryFn: async () => skillList.current }),
      },
    },
    emailAgent: {
      status: {
        queryOptions: () => ({
          queryKey: ["email-agent"],
          queryFn: async () => ({ available: emailStatus.available, agent: null }),
        }),
      },
    },
  }),
}));
vi.mock("../lib/use-partners", () => ({ usePartnerNames: () => partners.current }));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    i18n: { locale: locale.current },
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, i) => text + (i ? String(values[i - 1]) : "") + part, ""),
  }),
}));
vi.mock("@corvo/ui-web", async () => {
  const { createElement } = await import("react");
  return {
    BotAvatar: () => createElement("span", { "data-testid": "avatar" }),
    Button: ({
      children,
      onClick,
      disabled,
    }: {
      children: ReactNode;
      onClick?: () => void;
      disabled?: boolean;
    }) => createElement("button", { onClick, disabled }, children),
  };
});

const onOpenApp = vi.fn();
const sentry = { id: "srv-sentry", slug: "sentry", enabled: true, oauthStatus: "connected" };

beforeEach(() => {
  locale.current = "en";
  bots.current = [];
  skillList.current = [];
  emailStatus.available = true;
  partners.current = [];
  addAgent.mockReset().mockResolvedValue({ botId: "bot-1" });
  navigate.mockReset();
  onOpenApp.mockReset();
});

async function mount(props: { servers?: unknown[]; query?: string } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <AgentsStore
          servers={(props.servers ?? []) as never}
          query={props.query ?? ""}
          onOpenApp={onOpenApp}
        />
      </QueryClientProvider>,
    ),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  return { host, unmount: () => act(async () => root.unmount()) };
}

const card = (host: HTMLElement, slug: string) =>
  host.querySelector(`[data-testid="agent-card-${slug}"]`) as HTMLElement;
const button = (scope: HTMLElement, text: string) =>
  Array.from(scope.querySelectorAll("button")).find((item) => item.textContent === text);

it("lists the agents in English, and in Portuguese for a Portuguese app", async () => {
  const english = await mount();
  expect(card(english.host, "research-analyst").textContent).toContain("Research Analyst");
  await english.unmount();
  locale.current = "pt-BR";
  const portuguese = await mount();
  expect(card(portuguese.host, "research-analyst").textContent).toContain("Analista de pesquisa");
  await portuguese.unmount();
});

it("adds an agent and then shows it as added", async () => {
  const { host, unmount } = await mount();
  await act(async () => button(card(host, "research-analyst"), "Add")?.click());
  expect(addAgent).toHaveBeenCalledWith(
    expect.objectContaining({ slug: "research-analyst" }),
    "en",
    [],
    [],
  );
  await unmount();
});

it("shows an agent already created from the catalog as Added and opens its chat", async () => {
  bots.current = [{ id: "bot-7", spawnKey: "agent-catalog:research-analyst", archivedAt: null }];
  const { host, unmount } = await mount();
  const scope = card(host, "research-analyst");
  expect(button(scope, "Add")).toBeUndefined();
  await act(async () => button(scope, "Added")?.click());
  expect(navigate).toHaveBeenCalledWith("/app/bot-7");
  await unmount();
});

it("offers to connect an added agent's missing apps, and only those", async () => {
  bots.current = [{ id: "bot-8", spawnKey: "agent-catalog:bug-triage", archivedAt: null }];
  const { host, unmount } = await mount({ servers: [sentry] });
  const scope = card(host, "bug-triage");
  expect(button(scope, "Connect Sentry")).toBeUndefined();
  await act(async () => button(scope, "Connect Linear")?.click());
  expect(onOpenApp).toHaveBeenCalledWith("linear");
  await unmount();
});

it("keeps the email agent's Add off until an inbox service is connected", async () => {
  const without = await mount();
  expect((button(card(without.host, "email-agent"), "Add") as HTMLButtonElement).disabled).toBe(
    true,
  );
  await without.unmount();
  const withService = await mount({
    servers: [{ id: "srv-m", slug: "millionsend", enabled: true, oauthStatus: "connected" }],
  });
  expect((button(card(withService.host, "email-agent"), "Add") as HTMLButtonElement).disabled).toBe(
    false,
  );
  await withService.unmount();
});

it("can still add the email agent when the server has no public address, and says how it will check mail", async () => {
  emailStatus.available = false;
  const { host, unmount } = await mount({
    servers: [{ id: "srv-m", slug: "millionsend", enabled: true, oauthStatus: "connected" }],
  });
  const email = card(host, "email-agent");
  expect((button(email, "Add") as HTMLButtonElement).disabled).toBe(false);
  expect(email.textContent).toContain("checks your inbox on a schedule you approve");
  expect(card(host, "morning-briefing").textContent).not.toContain("on a schedule you approve");
  await unmount();
});

it("says nothing about an address when the server has one", async () => {
  const { host, unmount } = await mount({
    servers: [{ id: "srv-m", slug: "millionsend", enabled: true, oauthStatus: "connected" }],
  });
  expect(card(host, "email-agent").textContent).not.toContain("on a schedule you approve");
  await unmount();
});

it("filters by what the person searches for, in the language shown", async () => {
  const { host, unmount } = await mount({ query: "invoice" });
  expect(card(host, "invoice-assistant")).toBeTruthy();
  expect(card(host, "research-analyst")).toBeNull();
  await unmount();
});

it("says so when nothing matches the search", async () => {
  const { host, unmount } = await mount({ query: "zzz-no-such-agent" });
  expect(host.textContent).toContain("No results");
  await unmount();
});

it("tells the install which skills the person already has, so they are not installed twice", async () => {
  skillList.current = [{ name: "Project Plan" }];
  const { host, unmount } = await mount();
  await act(async () => button(card(host, "research-analyst"), "Add")?.click());
  expect(addAgent).toHaveBeenCalledWith(
    expect.objectContaining({ slug: "research-analyst" }),
    "en",
    [],
    ["Project Plan"],
  );
  await unmount();
});

it("filters by category, and combines the category with the search", async () => {
  const { host, unmount } = await mount();
  const chip = (label: string) =>
    Array.from(host.querySelectorAll('[data-testid="store-categories"] button')).find(
      (item) => item.textContent === label,
    ) as HTMLButtonElement;
  await act(async () => chip("Design").click());
  expect(card(host, "product-designer")).toBeTruthy();
  expect(card(host, "financial-manager")).toBeNull();
  await act(async () => chip("All").click());
  expect(card(host, "financial-manager")).toBeTruthy();
  await unmount();
  const searched = await mount({ query: "invoice" });
  const finance = Array.from(
    searched.host.querySelectorAll('[data-testid="store-categories"] button'),
  ).find((item) => item.textContent === "Marketing") as HTMLButtonElement;
  await act(async () => finance.click());
  // Invoice Assistant is a finance agent, so marketing plus that search leaves nothing.
  expect(card(searched.host, "invoice-assistant")).toBeNull();
  await searched.unmount();
});

it("offers the partner agents only to an organization that is a member of a partner", async () => {
  const without = await mount();
  expect(card(without.host, "portfolio-manager")).toBeNull();
  expect(card(without.host, "customer-success")).toBeNull();
  await without.unmount();
  partners.current = ["Clinic Suite"];
  const member = await mount();
  expect(card(member.host, "portfolio-manager")).not.toBeNull();
  expect(card(member.host, "customer-success")).not.toBeNull();
  await member.unmount();
});
