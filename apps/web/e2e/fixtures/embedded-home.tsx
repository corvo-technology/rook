import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { applyEmbedAccent } from "../../src/lib/embed";
import { embedTabs, quickActions } from "../../src/lib/embedded-home";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { applyResolvedAppearance } from "../../src/lib/ui-appearance";
import "../../src/styles.css";
import "../../src/pages/home/home.css";
import { EmbeddedHome } from "../../src/pages/home/EmbeddedHome";
import { HomeComposer } from "../../src/pages/home/HomeComposer";
import { EmbedTabs } from "../../src/pages/shell/embed-tabs";

// The embedded Home of each Greenflow product, from fixtures, so it can be checked without a
// backend. State lives in the URL: ?partner=prontu|greenbarber|divellas&theme=light|dark
// &balance=normal|low|lapsed|none&width=<px>.

const params = new URLSearchParams(location.search);
const partner = params.get("partner") ?? "prontu";
const theme = params.get("theme") === "dark" ? "dark" : "light";
const state = params.get("balance") ?? "normal";

const PARTNERS: Record<
  string,
  { chief: string; accent: string; actions: { label: string; prompt?: string; open?: string }[] }
> = {
  prontu: {
    chief: "Assistente Prontu",
    accent: "#0f766e",
    actions: [
      { label: "Resumo da agenda de hoje", prompt: "x" },
      { label: "Pacientes para retorno", prompt: "x" },
      { label: "Gravar consulta (abrir no Prontu)", open: "/consultas/gravar" },
      { label: "Resumo do mês", prompt: "x" },
    ],
  },
  greenbarber: {
    chief: "Assistente GreenBarber",
    accent: "#16a34a",
    actions: [
      { label: "Quem vem hoje?", prompt: "x" },
      { label: "Clientes sumidos há 30+ dias", prompt: "x" },
      { label: "Faturamento da semana", prompt: "x" },
    ],
  },
  divellas: {
    chief: "Assistente Divellas",
    accent: "#c026a3",
    actions: [
      { label: "Quem vem hoje?", prompt: "x" },
      { label: "Clientes sumidas há 30+ dias", prompt: "x" },
      { label: "Faturamento da semana", prompt: "x" },
    ],
  },
};
const config = PARTNERS[partner] ?? (PARTNERS.prontu as (typeof PARTNERS)[string]);

const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const chief = { id: "chief", name: config.chief, color: "#14B8A6", starters: [] };
const bots = [
  chief,
  { id: "rec", name: "Recepção", color: "#F59E0B", starters: [] },
  { id: "ges", name: "Gestor", color: "#6366F1", starters: [] },
];

const BALANCES = {
  normal: { remaining: 1800, lowThresholdReached: false, state: "active" },
  low: { remaining: 450, lowThresholdReached: true, state: "active" },
  lapsed: { remaining: 0, lowThresholdReached: false, state: "lapsed" },
} as const;
const balance =
  state in BALANCES
    ? {
        currency: "BRL",
        planCredit: 3000,
        used: 3000 - BALANCES[state as keyof typeof BALANCES].remaining,
        periodEnd: null,
        checkoutUrl: "https://pay.example.test/buy",
        ...BALANCES[state as keyof typeof BALANCES],
      }
    : null;

function Page() {
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const tabs = embedTabs({ hidden: ["store"], ticketBoardEnabled: true });
  return (
    <div
      className="flex flex-col bg-background text-foreground"
      style={{ height: "100vh", width: params.get("width") ? `${params.get("width")}px` : "100%" }}
    >
      <EmbedTabs
        tabs={tabs}
        pathname="/app/home"
        chiefName={config.chief}
        onOpen={() => undefined}
      />
      <div className="min-h-0 flex-1">
        <EmbeddedHome
          greeting="Bom dia, Ana"
          actions={quickActions({ quickActions: config.actions }, bots as never, "chief")}
          onAction={() => undefined}
          composer={
            <HomeComposer
              bots={bots as never}
              target={chief as never}
              onTarget={() => undefined}
              text={text}
              onText={setText}
              sending={false}
              error={null}
              onSend={() => undefined}
              inputRef={input}
              suggestions={false}
            />
          }
          waiting={{
            total: 1,
            items: [
              {
                runId: "r3",
                messageId: "m1",
                botId: "rec",
                botName: "Recepção",
                botColor: "#F59E0B",
                block: { kind: "ask", text: "Confirmar a remarcação de 3 consultas de amanhã?" },
                createdAt: iso(-60_000),
              },
            ] as never,
          }}
          working={{
            total: 1,
            items: [
              {
                runId: "r1",
                botId: "ges",
                botName: "Gestor",
                groupId: null,
                groupName: null,
                threadId: "t1",
                status: "running",
                trigger: "routine",
                notificationsEnabled: true,
                promptSnippet: "Montando o resumo da semana",
                agentMessage: null,
                updatedAt: iso(0),
                startedAt: iso(-90_000),
              },
            ] as never,
          }}
          bots={bots as never}
          balance={balance}
          locale="pt-BR"
          onGiveWork={() => input.current?.focus()}
        />
      </div>
    </div>
  );
}

applyResolvedAppearance(theme);
applyEmbedAccent(config.accent);
await bootstrapI18n("pt-BR");
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Page />
      </MemoryRouter>
    </QueryClientProvider>
  </I18nProvider>,
);
