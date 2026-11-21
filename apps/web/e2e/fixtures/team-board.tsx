import type { SpaceBot, SpaceGroup } from "@corvo/contracts";
import { BOT_COLOR_LIST } from "@corvo/core";
import { I18nProvider } from "@lingui/react";
import { createRoot } from "react-dom/client";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { buildTeamRoster } from "../../src/lib/team-roster";
import { applyResolvedAppearance } from "../../src/lib/ui-appearance";
import "../../src/styles.css";
import { TeamBoard } from "../../src/pages/TeamBoard";

// The Team screen's board over a fake company, so its look can be checked without a backend.
// State lives in the URL (?theme=light|dark&locale=en|pt-BR).

const params = new URLSearchParams(location.search);
const locale = params.get("locale") === "en" ? "en" : "pt-BR";
const hex = (id: string) => BOT_COLOR_LIST.find((color) => color.id === id)?.hex ?? "#3B82F6";
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const bots: SpaceBot[] = [
  [
    "chief",
    "Rook",
    "Orquestra os times e decide quem faz o quê",
    "green",
    "running",
    0,
    "onboarding:first",
  ],
  ["produto", "Análise de produto", "Pesquisa de produto e métricas", "cyan", "failed", 2 * HOUR],
  ["ops", "Monitoramento operacional", "Vigia erros, deploys e filas", "red", "running", 0],
  [
    "pautas",
    "Pautas e reuniões",
    "Prepara pautas e registra decisões",
    "magenta",
    "idle",
    5 * HOUR,
  ],
  [
    "redacao",
    "Redação de conteúdo",
    "Escreve posts e artigos",
    "magenta",
    "waiting_input",
    1 * HOUR,
  ],
  ["local", "Presença local", "Perfil local e avaliações", "cyan", "idle", 3 * HOUR],
  ["redes", "Gestão de redes sociais", "Agenda e publica nas redes", "magenta", "idle", 26 * HOUR],
  [
    "pesquisa",
    "Pesquisa estratégica",
    "Mercado, concorrentes e tendências",
    "green",
    "idle",
    9 * HOUR,
  ],
  ["resumo", "Resumo diário", "Resumo do dia por e-mail", "blue", "idle", 22 * HOUR],
  ["nfse", "Emissão de NFS-e", "Emite notas fiscais de serviço", "orange", "idle", 40 * 60_000],
  ["caixa", "Fluxo de caixa", "Projeta entradas e saídas", "green", "failed", 7 * HOUR],
  ["preco", "Precificação", "Revisa preços e margens", "green", "idle", 2 * 24 * HOUR],
  ["folha", "Folha e obrigações fiscais", "Folha, impostos e prazos", "blue", "failed", 6 * HOUR],
  ["dev1", "Revisão de código", "Revisa pull requests", "violet", "idle", 4 * HOUR],
  ["dev2", "Infraestrutura e SRE", "Alertas, releases e disponibilidade", "gray", "running", 0],
  ["vendas1", "Qualificação de leads", "Qualifica e prioriza contatos", "yellow", "idle", 8 * HOUR],
  ["vendas2", "Propostas", "Monta propostas comerciais", "orange", "idle", 30 * HOUR],
  ["extra", "Agente sem time", "Ainda não está em um time", "blue", "idle", 12 * HOUR],
].map(([id, name, title, color, status, age, spawnKey]) => ({
  id: id as string,
  spaceId: "s",
  name: name as string,
  title: title as string,
  color: hex(color as string),
  notifyOnFinish: true,
  pinned: false,
  sectionId: null,
  unread: false,
  parentBotId: id === "chief" ? null : "chief",
  preview: "Stopped. This was still waiting for…",
  status: status as string,
  runErrorId: null,
  updatedAt: ago(age as number),
  spawnKey: (spawnKey as string | undefined) ?? null,
}));

const team = (id: string, name: string, purpose: string | null, ids: string[]): SpaceGroup => ({
  id,
  spaceId: "s",
  name,
  purpose,
  pinned: false,
  sectionId: null,
  members: ids.map((botId) => ({ botId, name: botId, color: "#000" })),
  preview: "",
  unread: false,
  updatedAt: ago(HOUR),
});

const groups = [
  team("produto-ops", "Produto e Operações", "Analisa produto e rotinas e vigia a operação", [
    "produto",
    "ops",
    "pautas",
  ]),
  team("marketing", "Marketing e Conteúdo", "Conteúdo, presença local e redes sociais", [
    "redacao",
    "local",
    "redes",
  ]),
  team("estrategia", "Estratégia e Gestão", "Pesquisa de mercado e resumos para decidir", [
    "pesquisa",
    "resumo",
  ]),
  team("financeiro", "Financeiro", "Notas fiscais, caixa, preços e folha", [
    "nfse",
    "caixa",
    "preco",
    "folha",
  ]),
  team("engenharia", "Engenharia", "Código, infraestrutura e disponibilidade", ["dev1", "dev2"]),
  team("vendas", "Vendas", "Qualifica contatos e fecha propostas", ["vendas1", "vendas2"]),
];

function Page() {
  return (
    <main className="min-h-screen bg-background px-6 py-4 text-foreground">
      <h1 className="py-4 text-base font-medium">Team</h1>
      <TeamBoard roster={buildTeamRoster(bots, groups)} onOpen={() => undefined} />
    </main>
  );
}

applyResolvedAppearance(params.get("theme") === "light" ? "light" : "dark");
await bootstrapI18n(locale);
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <Page />
  </I18nProvider>,
);
