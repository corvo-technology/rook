import type { StarterRoutine } from "@corvo/contracts";

const NO_DATA_EN = "If you cannot reach the data yet, say what to connect in one line and stop.";
const NO_DATA_PT =
  "Se ainda não conseguir acessar os dados, diga em uma linha o que conectar e pare.";

/**
 * The routines each catalog agent sets up for its owner when it is added. Every one only reads,
 * summarizes, drafts or reminds, and stays quiet when there is nothing to say; anything that acts
 * outside the app is approved when the routine runs. Times are the owner's local time.
 */
export const STARTER_ROUTINES: Readonly<Record<string, readonly StarterRoutine[]>> = {
  "payments-watcher": [
    {
      key: "weekly-payments",
      name: { en: "Payments check", "pt-BR": "Checagem de cobranças" },
      cron: "0 9 * * 1",
      prompt: {
        en: `List last week's failed payments and the overdue invoices, who to contact first and why. Do not refund, charge or change anything. ${NO_DATA_EN}`,
        "pt-BR": `Liste os pagamentos que falharam e as faturas atrasadas da semana passada, quem contatar primeiro e por quê. Não reembolse, cobre nem altere nada. ${NO_DATA_PT}`,
      },
    },
  ],
  "ops-watcher": [
    {
      key: "morning-status",
      name: { en: "Morning status", "pt-BR": "Status da manhã" },
      cron: "0 9 * * 1-5",
      prompt: {
        en: `Check which alerts are firing and how error rates moved since yesterday. Say what needs attention now; if everything is fine, stay quiet. Never silence an alert or change a setting. ${NO_DATA_EN}`,
        "pt-BR": `Veja quais alertas estão disparando e como as taxas de erro mudaram desde ontem. Diga o que pede atenção agora; se estiver tudo bem, fique em silêncio. Nunca silencie um alerta nem mude uma configuração. ${NO_DATA_PT}`,
      },
    },
  ],
  "bug-triage": [
    {
      key: "new-errors",
      name: { en: "New errors", "pt-BR": "Erros novos" },
      cron: "30 9 * * 1-5",
      prompt: {
        en: `Look at the errors since the last check, group the ones with the same cause and say which matter most. Do not file issues; list the ones worth filing and ask first. Stay quiet when nothing new matters. ${NO_DATA_EN}`,
        "pt-BR": `Veja os erros desde a última checagem, agrupe os de mesma causa e diga quais mais importam. Não abra tarefas; liste as que valem abrir e pergunte antes. Fique em silêncio quando nada novo importar. ${NO_DATA_PT}`,
      },
    },
  ],
  "project-planner": [
    {
      key: "week-check",
      name: { en: "Week check", "pt-BR": "Revisão da semana" },
      cron: "0 9 * * 1",
      prompt: {
        en: `Review the plan: what moved last week, what is blocked and the next three steps. Keep it short and change nothing without asking. ${NO_DATA_EN}`,
        "pt-BR": `Revise o plano: o que andou na semana passada, o que está bloqueado e os três próximos passos. Seja breve e não altere nada sem perguntar. ${NO_DATA_PT}`,
      },
    },
  ],
  "sales-prospector": [
    {
      key: "weekly-prospects",
      name: { en: "Weekly prospects", "pt-BR": "Prospects da semana" },
      cron: "0 9 * * 1",
      prompt: {
        en: "Find up to five companies that fit the customer profile and draft a first message for each. Show the drafts; never send anything.",
        "pt-BR":
          "Encontre até cinco empresas que combinam com o perfil de cliente e rascunhe uma primeira mensagem para cada. Mostre os rascunhos; nunca envie nada.",
      },
    },
  ],
  "task-manager": [
    {
      key: "stuck-tasks",
      name: { en: "Stuck tasks", "pt-BR": "Tarefas paradas" },
      cron: "0 9 * * 1-5",
      prompt: {
        en: `List new tasks to sort and tasks stuck for days, with who owns each. Suggest the nudges but do not message anyone. Stay quiet when the board is tidy. ${NO_DATA_EN}`,
        "pt-BR": `Liste as tarefas novas para organizar e as paradas há dias, com o responsável de cada uma. Sugira os lembretes, mas não mande mensagem a ninguém. Fique em silêncio quando o quadro estiver em ordem. ${NO_DATA_PT}`,
      },
    },
  ],
  "collections-assistant": [
    {
      key: "overdue-reminders",
      name: { en: "Overdue reminders", "pt-BR": "Lembretes de atraso" },
      cron: "0 9 * * 1",
      prompt: {
        en: `Find the payments overdue and draft a polite reminder for each customer, in the right tone. Show the drafts; never send them. ${NO_DATA_EN}`,
        "pt-BR": `Encontre os pagamentos atrasados e rascunhe um lembrete educado para cada cliente, no tom certo. Mostre os rascunhos; nunca envie. ${NO_DATA_PT}`,
      },
    },
  ],
  "feedback-analyst": [
    {
      key: "weekly-themes",
      name: { en: "Feedback themes", "pt-BR": "Temas do feedback" },
      cron: "0 16 * * 5",
      prompt: {
        en: `Group what customers said this week into themes and say which to fix first, with a quote for each. ${NO_DATA_EN}`,
        "pt-BR": `Agrupe o que os clientes disseram nesta semana em temas e diga quais corrigir primeiro, com uma citação de cada. ${NO_DATA_PT}`,
      },
    },
  ],
  "social-media-manager": [
    {
      key: "week-ideas",
      name: { en: "Content ideas", "pt-BR": "Ideias de conteúdo" },
      cron: "0 9 * * 1",
      prompt: {
        en: "Draft three post ideas for this week, each with a first line and the channel it fits. Publish nothing.",
        "pt-BR":
          "Rascunhe três ideias de post para esta semana, cada uma com a primeira linha e o canal em que cabe. Não publique nada.",
      },
    },
    {
      key: "week-results",
      name: { en: "What worked", "pt-BR": "O que funcionou" },
      cron: "0 17 * * 5",
      prompt: {
        en: `Read how this week's posts did and say what worked and what to repeat. ${NO_DATA_EN}`,
        "pt-BR": `Leia como foram os posts desta semana e diga o que funcionou e o que repetir. ${NO_DATA_PT}`,
      },
    },
  ],
  "financial-manager": [
    {
      key: "weekly-cash",
      name: { en: "Cash this week", "pt-BR": "Caixa da semana" },
      cron: "30 8 * * 1",
      prompt: {
        en: `Show the cash for the next 90 days, the bills to pay first this week and any expense that grew for no reason. Move no money. ${NO_DATA_EN}`,
        "pt-BR": `Mostre o caixa dos próximos 90 dias, as contas a pagar primeiro nesta semana e qualquer despesa que cresceu sem motivo. Não movimente dinheiro. ${NO_DATA_PT}`,
      },
    },
  ],
  "inventory-manager": [
    {
      key: "low-stock",
      name: { en: "Low stock", "pt-BR": "Estoque baixo" },
      cron: "0 8 * * 1-5",
      prompt: {
        en: "Check stock against recent sales and list what to reorder soon. Stay quiet when nothing is running low. Order nothing.",
        "pt-BR":
          "Confira o estoque contra as vendas recentes e liste o que repor em breve. Fique em silêncio quando nada estiver acabando. Não faça pedidos.",
      },
    },
  ],
  "reputation-manager": [
    {
      key: "new-reviews",
      name: { en: "New reviews", "pt-BR": "Avaliações novas" },
      cron: "0 9 * * 1",
      prompt: {
        en: "Read the new customer reviews and draft a reply for each one. Show the drafts; never post a reply.",
        "pt-BR":
          "Leia as avaliações novas de clientes e rascunhe uma resposta para cada uma. Mostre os rascunhos; nunca publique uma resposta.",
      },
    },
  ],
  "ad-analyst": [
    {
      key: "weekly-ads",
      name: { en: "Ads summary", "pt-BR": "Resumo dos anúncios" },
      cron: "0 9 * * 1",
      prompt: {
        en: `Read last week's ad results and say what to pause, keep, scale and fix. Change no campaign. ${NO_DATA_EN}`,
        "pt-BR": `Leia os resultados dos anúncios da semana passada e diga o que pausar, manter, escalar e corrigir. Não altere nenhuma campanha. ${NO_DATA_PT}`,
      },
    },
  ],
  "product-analyst": [
    {
      key: "weekly-usage",
      name: { en: "Weekly usage", "pt-BR": "Uso da semana" },
      cron: "0 9 * * 1",
      prompt: {
        en: `Give the numbers for how people used the product last week against the week before, and what stands out. ${NO_DATA_EN}`,
        "pt-BR": `Dê os números de como as pessoas usaram o produto na semana passada contra a anterior, e o que chama atenção. ${NO_DATA_PT}`,
      },
    },
  ],
  "operations-manager": [
    {
      key: "week-plan",
      name: { en: "Week plan", "pt-BR": "Plano da semana" },
      cron: "30 8 * * 1",
      prompt: {
        en: `Plan the week on one page: how the business stands and what needs a decision. ${NO_DATA_EN}`,
        "pt-BR": `Planeje a semana em uma página: como o negócio está e o que precisa de decisão. ${NO_DATA_PT}`,
      },
    },
  ],
  "payroll-tax-prep": [
    {
      key: "month-calendar",
      name: { en: "Month obligations", "pt-BR": "Obrigações do mês" },
      cron: "0 9 1 * *",
      prompt: {
        en: "Remind me of this month's payroll items to collect and tax dates, to confirm with my accountant. Pay and file nothing.",
        "pt-BR":
          "Me lembre dos itens da folha a reunir neste mês e das datas de impostos, para confirmar com meu contador. Não pague nem declare nada.",
      },
    },
  ],
  "pocket-accountant": [
    {
      key: "month-close",
      name: { en: "Month close", "pt-BR": "Fechamento do mês" },
      cron: "0 9 27 * *",
      prompt: {
        en: "Start the month's checklist for the accountant and list what is still missing. Send nothing.",
        "pt-BR":
          "Comece o checklist do mês para o contador e liste o que ainda falta. Não envie nada.",
      },
    },
  ],
};
