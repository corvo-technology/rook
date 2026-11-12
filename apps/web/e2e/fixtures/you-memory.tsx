import type { UserMemory } from "@corvo/contracts";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryFactCard } from "../../src/components/MemoryFactCard";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { applyResolvedAppearance } from "../../src/lib/ui-appearance";
import { type YouApi, YouMemory } from "../../src/pages/YouMemory";
import "../../src/styles.css";

// What an agent knows about the person, over a made-up person, so the screen can be checked
// without a backend. State lives in the URL (?theme=light|dark&locale=en|pt-BR).

const params = new URLSearchParams(location.search);
const at = "2026-11-01T10:00:00.000Z";
let memories: UserMemory[] = [
  {
    id: "n1",
    text: "Runs a small bakery in Lisbon",
    state: "pending",
    source: "agent",
    createdAt: at,
    stale: false,
  },
  {
    id: "k1",
    text: "Prefers answers in Portuguese, short and plain",
    state: "saved",
    source: "typed",
    createdAt: at,
    stale: false,
  },
  {
    id: "k2",
    text: "Allergic to peanuts",
    state: "saved",
    source: "agent",
    createdAt: at,
    stale: false,
  },
  {
    id: "s1",
    text: "Works from the Porto office on Tuesdays",
    state: "saved",
    source: "typed",
    createdAt: at,
    stale: true,
  },
  {
    id: "f1",
    text: "Has a dog called Rex",
    state: "forgotten",
    source: "learned",
    createdAt: at,
    stale: false,
  },
];
let learn = false;
const move = (memoryId: string, change: Partial<UserMemory>) => {
  memories = memories.map((memory) => (memory.id === memoryId ? { ...memory, ...change } : memory));
  return memories.find((memory) => memory.id === memoryId)!;
};

const api: YouApi = {
  list: async () => memories,
  add: async ({ text }) => {
    const created: UserMemory = {
      id: `t${memories.length}`,
      text,
      state: "saved",
      source: "typed",
      createdAt: at,
      stale: false,
    };
    memories = [created, ...memories];
    return created;
  },
  edit: async ({ memoryId, text }) => move(memoryId, { text }),
  decide: async ({ memoryId, decision }) => {
    if (decision === "erase") {
      memories = memories.filter((memory) => memory.id !== memoryId);
      return null;
    }
    const state = decision === "save" || decision === "keep" ? "saved" : "forgotten";
    return move(memoryId, { state, stale: false });
  },
  settings: {
    get: async () => ({ learn }),
    set: async (patch) => {
      learn = patch.learn ?? learn;
      return { learn };
    },
  },
};

function Screen() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 bg-background p-6 text-foreground">
      <h1 className="text-base font-medium">Memory</h1>
      <YouMemory api={api} />
      <div data-testid="card-waiting">
        <MemoryFactCard
          memory={{ text: "Runs a small bakery in Lisbon", state: "pending" }}
          onDecide={() => undefined}
        />
      </div>
      <div data-testid="card-saved">
        <MemoryFactCard
          memory={{ text: "Allergic to peanuts", state: "saved" }}
          onDecide={() => undefined}
        />
      </div>
    </div>
  );
}

applyResolvedAppearance(params.get("theme") === "light" ? "light" : "dark");
await bootstrapI18n(params.get("locale") === "pt-BR" ? "pt-BR" : "en");
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Screen />
    </QueryClientProvider>
  </I18nProvider>,
);
