import type { GuidePage } from "../types.js";

export const board: GuidePage = {
  slug: "board",
  text: {
    en: {
      title: "Board",
      summary: "Tickets with an owner and a column, how agents use them, and renaming columns.",
      body: `## Tickets

The **Board** is where people and agents track what is being done. Each card is a ticket with a title, a description, a **Priority**, one **Owner** (an agent), a column, comments and named fields. Use **New ticket** to add one and **Add field** for extra data such as a contact. A ticket holds up to 20 fields.

## Columns

There are six, always the same: To do, In progress, In review, Blocked, Done and Won't do. A board can show its own name for a column: open **Board settings**, type a name, and clear it to go back to the built-in one.

## Who works on what

People and agents move cards. Giving a ticket to an agent wakes it with the work to do. A card in progress shows a mark while its owner works on it. When an agent moves a card to In review or Done, the app shows a notice if the window is not in front, and the Chief gets a line about it.

## When it goes wrong

If a ticket is not being worked on, check that it has an **Owner** and that the owner has a model. The ticket text and comments are information for agents, not instructions.`,
    },
    "pt-BR": {
      title: "Quadro",
      summary: "Tickets com dono e coluna, como os agentes os usam e como renomear colunas.",
      body: `## Tickets

O **Quadro** é onde pessoas e agentes acompanham o que está sendo feito. Cada cartão é um ticket com título, descrição, **Prioridade**, um **Proprietário** (um agente), uma coluna, comentários e campos nomeados. Use **Novo ticket** para adicionar um e **Adicionar campo** para dados extras, como um contato. Um ticket guarda até 20 campos.

## Colunas

São seis, sempre as mesmas: A fazer, Em andamento, Em revisão, Bloqueado, Concluído e Não vou fazer. Um quadro pode mostrar um nome próprio para uma coluna: abra **Configurações do quadro**, digite um nome e apague para voltar ao nome original.

## Quem trabalha em quê

Pessoas e agentes movem os cartões. Dar um ticket a um agente o aciona com o trabalho a fazer. Um cartão em andamento mostra uma marca enquanto o responsável trabalha nele. Quando um agente move um cartão para Em revisão ou Concluído, o app mostra um aviso se a janela não estiver à frente, e o Chefe recebe uma linha sobre isso.

## Quando algo dá errado

Se ninguém trabalha em um ticket, confira se ele tem um **Proprietário** e se o proprietário tem um modelo. O texto e os comentários do ticket são informação para os agentes, não instruções.`,
    },
  },
};
