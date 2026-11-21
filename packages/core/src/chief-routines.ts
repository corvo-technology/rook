import type { StarterRoutine } from "@corvo/contracts";

/**
 * The routines Rook starts with in a new space, on from the first day. Each one only reads,
 * summarizes and plans, stays quiet when there is nothing worth saying, and anything it does
 * outside the app goes through the owner's approval. Times are the owner's local time.
 */
export const CHIEF_STARTER_ROUTINES: readonly StarterRoutine[] = [
  {
    key: "weekly-plan",
    name: { en: "Weekly plan", "pt-BR": "Plano da semana" },
    cron: "0 8 * * 1",
    prompt: {
      en: "Plan the week: the top priorities for each area or brand, from the open tickets and recent work, and who does what. Ask the owner only for decisions that are really theirs. Only read, summarize and plan; anything that acts outside goes through approval. Stay quiet if there is nothing to plan.",
      "pt-BR":
        "Monte o plano da semana: as principais prioridades de cada área ou marca, a partir dos tickets abertos e do trabalho recente, e quem faz o quê. Peça ao dono só as decisões que são realmente dele. Apenas leia, resuma e planeje; tudo que age fora passa por aprovação. Fique em silêncio se não houver nada a planejar.",
    },
  },
  {
    key: "daily-brief",
    name: { en: "Daily brief", "pt-BR": "Resumo do dia" },
    cron: "0 8 * * 2-5",
    prompt: {
      en: "Write one short brief: what changed since yesterday, the tickets that are stuck and the decisions the owner needs to make. Only read and summarize; anything that acts outside goes through approval. If nothing changed, stay quiet.",
      "pt-BR":
        "Escreva um resumo curto: o que mudou desde ontem, os tickets parados e as decisões que o dono precisa tomar. Apenas leia e resuma; tudo que age fora passa por aprovação. Se nada mudou, fique em silêncio.",
    },
  },
  {
    key: "board-review",
    name: { en: "Board review", "pt-BR": "Revisão do quadro" },
    cron: "0 14 * * 3",
    prompt: {
      en: "Review the board: stale or blocked tickets, duplicates and tickets with no owner. Fix what you can within approvals (comment or reassign) and list only what needs the owner. Anything that acts outside goes through approval. If the board is tidy, stay quiet.",
      "pt-BR":
        "Revise o quadro: tickets parados ou bloqueados, duplicados e sem responsável. Resolva o que puder dentro das aprovações (comentar ou reatribuir) e liste só o que precisa do dono. Tudo que age fora passa por aprovação. Se o quadro estiver em ordem, fique em silêncio.",
    },
  },
  {
    key: "weekly-wrap-up",
    name: { en: "Weekly wrap-up", "pt-BR": "Fechamento da semana" },
    cron: "0 17 * * 5",
    prompt: {
      en: "Wrap up the week: what was delivered, the key numbers and what moves to next week. If the wiki has a Decisions page, record the owner's decisions there. Only read and summarize; anything that acts outside goes through approval. If nothing happened, stay quiet.",
      "pt-BR":
        "Feche a semana: o que foi entregue, os números principais e o que passa para a próxima. Se a wiki tiver uma página Decisões, registre nela as decisões do dono. Apenas leia e resuma; tudo que age fora passa por aprovação. Se nada aconteceu, fique em silêncio.",
    },
  },
];
