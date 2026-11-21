import type { AreaWatch } from "@corvo/contracts";
import { agentCatalogSpawnKey, verticalSpawnKey } from "@corvo/contracts";

const SAFE_EN =
  "Draft what is needed and show it; never send, cancel or change anything yourself. Stay quiet if the change needs nothing from the person.";
const SAFE_PT =
  "Rascunhe o que for preciso e mostre; nunca envie, cancele nem altere nada por conta própria. Fique em silêncio se a mudança não pedir nada da pessoa.";

const appointments = (): AreaWatch => ({
  key: "calendar-changes",
  preset: "calendar",
  name: { en: "Schedule changes", "pt-BR": "Mudanças na agenda" },
  prompt: {
    en: `The calendar changed: a new, moved or cancelled booking, a clash, or one starting soon. Say what changed and what it means for the day, and propose the fix for a clash or a gap. ${SAFE_EN}`,
    "pt-BR": `A agenda mudou: um horário novo, remarcado ou cancelado, um conflito, ou um prestes a começar. Diga o que mudou e o que isso significa para o dia, e proponha a solução para um conflito ou um horário vago. ${SAFE_PT}`,
  },
});

const inbox = (en: string, pt: string): AreaWatch => ({
  key: "new-mail",
  preset: "email",
  name: { en: "New mail", "pt-BR": "Novos e-mails" },
  prompt: {
    en: `New mail arrived. ${en} ${SAFE_EN}`,
    "pt-BR": `Chegou e-mail novo. ${pt} ${SAFE_PT}`,
  },
});

/**
 * The change triggers each agent starts with, keyed by the agent's spawn key. Only what a
 * connected calendar or inbox can serve is listed. Payments and social comments are left out
 * on purpose: no integration offers a model-free preset for them yet, so a watch there would
 * be a guess at a tool's shape.
 */
export const AREA_WATCHES: Readonly<Record<string, readonly AreaWatch[]>> = {
  [verticalSpawnKey("clinica", "reception")]: [appointments()],
  [verticalSpawnKey("barbearia_salao", "reception")]: [appointments()],
  [verticalSpawnKey("restaurante", "reservations")]: [appointments()],
  [verticalSpawnKey("imobiliaria", "visits")]: [appointments()],
  [verticalSpawnKey("imobiliaria", "leads")]: [
    inbox(
      "Say who wrote about which property and draft a first reply that proposes a visit.",
      "Diga quem escreveu sobre qual imóvel e rascunhe uma primeira resposta propondo uma visita.",
    ),
  ],
  [agentCatalogSpawnKey("meeting-assistant")]: [appointments()],
  [agentCatalogSpawnKey("sales-prospector")]: [
    inbox(
      "Say which messages are replies from prospects or new leads, and draft the next step for each.",
      "Diga quais mensagens são respostas de prospects ou novos leads, e rascunhe o próximo passo de cada uma.",
    ),
  ],
  [agentCatalogSpawnKey("support-agent")]: [
    inbox(
      "Say which messages are customer questions or problems, in order of urgency, and draft a reply for each.",
      "Diga quais mensagens são dúvidas ou problemas de clientes, em ordem de urgência, e rascunhe uma resposta para cada uma.",
    ),
  ],
};

export const areaWatchTemplateKey = (watch: Pick<AreaWatch, "key">) => `area-watch:${watch.key}`;

export function areaWatchesFor(spawnKey: string | null | undefined): readonly AreaWatch[] {
  return (spawnKey ? AREA_WATCHES[spawnKey] : undefined) ?? [];
}
