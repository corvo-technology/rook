import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { EmbedBridge } from "../../src/components/EmbedBridge";
import { applyEmbedAccent, parseEmbedLaunch, tellParent } from "../../src/lib/embed";
import { onHostAsk } from "../../src/lib/embed-host";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { applyResolvedAppearance } from "../../src/lib/ui-appearance";
import "../../src/styles.css";
import { HostActionCard } from "../../src/pages/shell/host-action-card";
import { HostContextChip } from "../../src/pages/shell/host-context-chip";

// What the launcher's panel holds inside a partner's product: the chat alone, the page context
// chip above the composer, and an action card. From fixtures, so it needs no backend. The host
// page (launcher-host.html) loads the real sdk.js and talks to this frame through postMessage.

const launch = parseEmbedLaunch(location.hash);

function Frame() {
  const [asked, setAsked] = useState<string[]>([]);
  useEffect(() => onHostAsk((text) => setAsked((current) => [...current, text])), []);
  useEffect(() => tellParent({ type: "corvo:ready" }), []);
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <div className="max-w-[85%] self-end rounded-2xl bg-muted px-3 py-2">
          Esse cliente está sumido? Chama ele pra voltar.
        </div>
        <p className="leading-relaxed">
          Sim: o Carlos costuma vir a cada 21 dias e está há 34 sem aparecer. O Rafael tem horário
          amanhã às 10:20, o horário de sempre dele.
        </p>
        <HostActionCard
          botId="chief"
          messageId="m1"
          block={{
            kind: "host_action",
            actionId: "a1",
            name: "open_agenda",
            label: "Abrir na agenda",
            params: { day: "2026-11-19" },
            status: "pending",
          }}
        />
        {asked.map((text) => (
          <div key={text} className="max-w-[85%] self-end rounded-2xl bg-muted px-3 py-2">
            {text}
          </div>
        ))}
      </div>
      <HostContextChip />
      <div className="border-t border-border p-3">
        <div className="rounded-xl border border-border px-3 py-2.5 text-muted-foreground">
          Pergunte ou peça algo sobre o Carlos…
        </div>
      </div>
    </div>
  );
}

applyResolvedAppearance(launch.theme === "dark" ? "dark" : "light");
applyEmbedAccent(launch.accent);
await bootstrapI18n("pt-BR");
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <QueryClientProvider client={new QueryClient()}>
      <EmbedBridge />
      <Frame />
    </QueryClientProvider>
  </I18nProvider>,
);
