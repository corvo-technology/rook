import type { GuidePage } from "../types.js";

export const wiki: GuidePage = {
  slug: "wiki",
  text: {
    en: {
      title: "Wiki",
      summary: "Shared pages the team keeps, how agents use them, and approving proposed edits.",
      body: `## What it is

The **Wiki** is what your space's team knows, written as short pages that link to each other. Every member of the space can read and write it. Agents look in it before asking you something the team already knows, and cite the pages they used.

## Writing pages

Use **New page**, give it a **Title** and the **Page text**, and **Save**. Each save keeps the earlier text: open **History** and **Restore** a version. A page shows **Cited by** the pages that link to it. If a page changed while you were editing, you are asked to reload instead of overwriting the newer edit.

## What agents do

Agents only read the wiki. When an agent wants to keep something, it proposes a page or an edit and waits for approval.

## Approving edits

With **Learn from conversations** on, a cheap model reads finished conversations and proposes what is worth keeping. A card in the conversation shows what was kept, with **Approve** and **Refuse** and a way to undo. Proposals also wait under **Waiting for approval**. Turn off **Approve edits** in **Wiki settings** to let edits in without approval; only the space's owner changes settings.

## When it goes wrong

An edit marked as changed since means the page moved on before it was approved; open it and apply the change again. The wiki is not offered in chats that answer from a chat app.`,
    },
    "pt-BR": {
      title: "Wiki",
      summary:
        "Páginas compartilhadas que a equipe mantém, como os agentes as usam e como aprovar edições propostas.",
      body: `## O que é

A **Wiki** é o que a equipe do seu espaço sabe, escrito em páginas curtas que apontam umas para as outras. Todo membro do espaço pode ler e escrever. Os agentes olham nela antes de perguntar algo que a equipe já sabe e citam as páginas que usaram.

## Escrevendo páginas

Use **Nova página**, dê um **Título** e o **Texto da página**, e **Salvar**. Cada salvamento guarda o texto anterior: abra **Histórico** e **Restaurar** uma versão. Uma página mostra **Citada por** as páginas que apontam para ela. Se a página mudou enquanto você editava, o app pede para recarregar em vez de sobrescrever a edição mais nova.

## O que os agentes fazem

Os agentes só leem a wiki. Quando um agente quer guardar algo, propõe uma página ou uma edição e espera aprovação.

## Aprovando edições

Com **Aprender com as conversas** ligado, um modelo barato lê conversas encerradas e propõe o que vale guardar. Um cartão na conversa mostra o que foi guardado, com **Aprovar** e **Recusar** e uma forma de desfazer. As propostas também ficam em **Aguardando aprovação**. Desligue **Aprovar edições** em **Configurações da wiki** para deixar as edições entrarem sem aprovação; só o dono do espaço muda as configurações.

## Quando algo dá errado

Uma edição marcada como alterada desde então significa que a página mudou antes da aprovação; abra-a e aplique a mudança de novo. A wiki não é oferecida em conversas que respondem por um app de chat.`,
    },
  },
};
