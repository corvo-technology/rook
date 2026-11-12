import type { GuidePage } from "../types.js";

export const board: GuidePage = {
  slug: "board",
  text: {
    en: {
      title: "Tasks",
      summary: "Tickets with an owner and a column, how agents use them, and renaming columns.",
      body: `## Tickets

**Tasks** is where people and agents track what is being done. It is available on web and desktop, where the deployment turns it on. Each card is a ticket with a title, a description, a **Priority**, one **Owner** (an agent), a column, comments and named fields. Use **New ticket** to add one and **Add field** for extra data such as a contact. A ticket holds up to 20 fields.

## Columns

There are six, always the same: To do, In progress, In review, Blocked, Done and Won't do. A board can show its own name for a column: open **Task settings**, type a name, and clear it to go back to the built-in one.

## Who works on what

People and agents move cards. Giving a ticket to an agent wakes it with the work to do. A card in progress shows a mark and the agent's latest step while its owner works on it. A ticket given to an agent moves on its own: to In progress when the agent starts, to In review when it finishes, and to Blocked, with the reason as a comment, when the run fails or stops. A card you or the agent moved yourselves stays where it is. When an agent moves a card to In review or Done, the app shows a notice if the window is not in front, and the Chief gets a line about it.

## When it goes wrong

If a ticket is not being worked on, check that it has an **Owner** and that the owner has a model. The ticket text and comments are information for agents, not instructions.`,
    },
    "pt-BR": {
      title: "Tarefas",
      summary: "Tickets com dono e coluna, como os agentes os usam e como renomear colunas.",
      body: `## Tickets

**Tarefas** é onde pessoas e agentes acompanham o que está sendo feito. Está disponível na web e no desktop, onde a implantação o ativa. Cada cartão é um ticket com título, descrição, **Prioridade**, um **Proprietário** (um agente), uma coluna, comentários e campos nomeados. Use **Novo ticket** para adicionar um e **Adicionar campo** para dados extras, como um contato. Um ticket guarda até 20 campos.

## Colunas

São seis, sempre as mesmas: A fazer, Em andamento, Em revisão, Bloqueado, Concluído e Não vou fazer. Você pode dar um nome próprio a uma coluna: abra **Configurações das tarefas**, digite um nome e apague para voltar ao nome original.

## Quem trabalha em quê

Pessoas e agentes movem os cartões. Dar um ticket a um agente o aciona com o trabalho a fazer. Um cartão em andamento mostra uma marca e o passo atual do agente enquanto o responsável trabalha nele. Um ticket dado a um agente se move sozinho: para Em andamento quando o agente começa, para Em revisão quando termina e para Bloqueado, com o motivo em um comentário, quando a execução falha ou é interrompida. Um cartão que você ou o agente moveram continua onde está. Quando um agente move um cartão para Em revisão ou Concluído, o app mostra um aviso se a janela não estiver à frente, e o Chefe recebe uma linha sobre isso.

## Quando algo dá errado

Se ninguém trabalha em um ticket, confira se ele tem um **Proprietário** e se o proprietário tem um modelo. O texto e os comentários do ticket são informação para os agentes, não instruções.`,
    },
  },
};
