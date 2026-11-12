// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, part, index) => `${text}${values[index - 1] ?? ""}${part}`),
    i18n: { locale: "en" },
  }),
}));

const { bootstrap } = vi.hoisted(() => ({
  bootstrap: { current: {} as unknown },
}));
vi.mock("../lib/bootstrap", () => ({ takeInitialBootstrap: async () => bootstrap.current }));
vi.mock("../lib/auth", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { name: "Jamie", email: "jamie@example.test" } },
      refetch: async () => undefined,
    }),
  },
}));
vi.mock("../lib/query", () => {
  const procedure = (name: string) => ({
    queryKey: () => [name],
    queryOptions: () => ({ queryKey: [name], queryFn: async () => null }),
  });
  const queries = {
    bootstrap: { queryKey: () => ["bootstrap"] },
    usage: { summary: procedure("usage") },
    memory: { providerConfig: procedure("memory") },
    voice: { status: procedure("voice") },
  };
  return { useSpaceQueries: () => queries };
});
vi.mock("../lib/rpc", () => ({
  rpc: { voice: { status: async () => ({ ready: true }) } },
  rpcForSpace: () => ({}),
  selectedSpaceId: () => null,
  selectSpace: () => true,
}));
vi.mock("../lib/local-edition", () => ({ useLocalEdition: () => false }));
vi.mock("../components/ApprovalRulesSettings", () => ({ ApprovalRulesSettings: () => null }));
vi.mock("./AccountSettingsOverlay", () => ({
  ComputerSettingsPanel: () => null,
  GeneralSettingsPanels: () => null,
  UpdatesSettingsPanel: () => null,
  UsageSettingsPanel: () => null,
}));
vi.mock("./BillingSettingsPanel", () => ({ BillingSettingsPanel: () => null }));
vi.mock("./ConnectionsSettingsPanel", () => ({ ConnectionsSettingsPanel: () => null }));
vi.mock("./McpServersSettings", () => ({ McpServersSettings: () => null }));
vi.mock("./MemorySettingsOverlay", () => ({ MemorySettingsOverlay: () => null }));
vi.mock("./PartnershipSettingsPanel", () => ({ PartnershipSettingsPanel: () => null }));
const { scopes } = vi.hoisted(() => ({ scopes: [] as string[] }));
vi.mock("./ModelSettingsOverlay", () => ({
  ModelSettingsOverlay: ({ scope }: { scope: string }) => {
    scopes.push(`models:${scope}`);
    return null;
  },
}));
vi.mock("./VoiceSettingsOverlay", () => ({
  VoiceSettingsOverlay: ({ scope }: { scope: string }) => {
    scopes.push(`voice:${scope}`);
    return null;
  },
}));
vi.mock("./SpaceSettingsPanel", () => ({
  SpaceSettingsPanel: ({ space }: { space: { name: string } }) => (
    <div data-testid="space-settings">{space.name}</div>
  ),
}));

import { SettingsPage } from "./Settings";

const acme = { id: "space-a", name: "Acme" };
const beta = { id: "space-b", name: "Beta" };

function seed(me: Record<string, unknown>, spaces = [acme, beta]) {
  bootstrap.current = { me: { spaceId: "space-a", ...me }, spaces, bots: [], groups: [] };
}

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  scopes.length = 0;
  vi.unstubAllGlobals();
});

async function render(path: string) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/settings/space/:spaceId" element={<SettingsPage />} />
            <Route path="/settings/:section?" element={<SettingsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  for (let tick = 0; tick < 5; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  cleanup = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  return container;
}

const shown = (container: HTMLElement) =>
  container.querySelector("[data-settings-section]")?.getAttribute("data-settings-section");
const navItem = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-testid="settings-nav-${id}"]`);

it("has a route per section and edits the account's models and voice", async () => {
  seed({});
  const container = await render("/settings/models");
  expect(shown(container)).toBe("models");
  const voice = navItem(container, "voice") as HTMLButtonElement;
  await act(async () => voice.click());
  expect(shown(container)).toBe("voice");
  expect(new Set(scopes)).toEqual(new Set(["models:account", "voice:account"]));
});

it("lists the spaces under General and opens the one picked", async () => {
  seed({});
  const container = await render("/settings/general");
  const list = container.querySelector('[data-testid="settings-spaces"]');
  expect(list?.textContent).toContain("Acme");
  expect(list?.textContent).toContain("Beta");
  // Spaces live under General, not in the nav.
  expect(navItem(container, "space")).toBeNull();
  const manage = container.querySelector<HTMLButtonElement>('[aria-label="Manage Beta"]');
  await act(async () => manage?.click());
  expect(container.querySelector('[data-testid="space-settings"]')?.textContent).toBe("Beta");
  expect(container.querySelector("h1")?.textContent).toBe("Beta");
  expect(navItem(container, "general")?.getAttribute("aria-current")).toBe("page");
});

it("lists no spaces when there is only one", async () => {
  seed({}, [acme]);
  const container = await render("/settings/general");
  expect(container.querySelector('[data-testid="settings-spaces"]')).toBeNull();
});

it("opens a linked billing section once billing turns out to be on", async () => {
  seed({ billingEnabled: true });
  const container = await render("/settings/billing");
  expect(shown(container)).toBe("billing");
});

it("shows General for a section the account does not have", async () => {
  seed({ billingEnabled: false });
  const container = await render("/settings/billing");
  expect(shown(container)).toBe("general");
  expect(navItem(container, "billing")).toBeNull();
});

it("goes to General for a space that is gone", async () => {
  seed({});
  const container = await render("/settings/space/space-z");
  expect(shown(container)).toBe("general");
});

it("hides Updates outside the desktop app and shows it inside", async () => {
  seed({});
  const web = await render("/settings/general");
  expect(navItem(web, "updates")).toBeNull();
  await cleanup?.();
  vi.stubGlobal("corvoDesktop", { update: {} });
  const desktop = await render("/settings/general");
  expect(navItem(desktop, "updates")).not.toBeNull();
});
