import type { GuidePage } from "../types.js";

export const memory: GuidePage = {
  slug: "memory",
  text: {
    en: {
      title: "Memory",
      summary:
        "What agents remember, shared notes and open work, and connecting a memory provider.",
      body: `## What agents remember

Agents keep notes between conversations. A bot's settings show its notes and its **Open work**: items still to do, which you can add yourself with **Add open work**. Under **Advanced**, **Skills** lists its saved how-tos, which you can edit or delete.

Open **Settings** › **Memory** for **Shared memory**: notes every agent in the space reads and keeps up to date.

## Memory providers

By default memory is the built-in notes. A space can also use **Connect memory provider** to add an outside provider (Supermemory, Serenity or Honcho), in the cloud or on a server you run. With one connected, **Default scope** is **Isolated** or **Shared** for new bots, and a bot can override it with **Memory scope** under **Advanced**. Serenity also offers **Recall and write** or **Recall only**. **Disconnect** returns to the built-in notes.

## Memory and the wiki

Memory is private working notes. Pages the whole team should keep live in the wiki; see the wiki page.

## When it goes wrong

If an agent forgets something, check **Shared memory** and the bot's own notes for whether it was kept. With a provider, check the bot's **Memory scope** is not **Isolated** when another agent should know it. A provider that fails to connect leaves the built-in notes working.`,
    },
    "pt-BR": {
      title: "Memória",
      summary:
        "O que os agentes lembram, notas compartilhadas e trabalho aberto, e como conectar um provedor de memória.",
      body: `## O que os agentes lembram

Os agentes guardam notas entre conversas. As configurações de um bot mostram as notas dele e o **Trabalho aberto**: itens ainda por fazer, que você mesmo pode adicionar com **Adicionar trabalho pendente**. Em **Avançado**, **Habilidades** lista os roteiros salvos, que você pode editar ou excluir.

Abra **Configurações** › **Memória** para ver a **Memória compartilhada**: notas que todos os agentes do espaço leem e mantêm atualizadas.

## Provedores de memória

Por padrão a memória são as notas integradas. Um espaço também pode usar **Conectar provedor de memória** para adicionar um provedor externo (Supermemory, Serenity ou Honcho), na nuvem ou em um servidor seu. Com um conectado, o **Escopo padrão** é **Isolado** ou **Compartilhado** para bots novos, e um bot pode mudar isso com **Escopo de memória** em **Avançado**. O Serenity também oferece **Lembrar e escrever** ou **Só lembrar**. **Desconectar** volta para as notas integradas.

## Memória e a wiki

A memória são notas de trabalho privadas. Páginas que a equipe toda deve manter ficam na wiki; veja a página da wiki.

## Quando algo dá errado

Se um agente esqueceu algo, veja na **Memória compartilhada** e nas notas do próprio bot se foi guardado. Com um provedor, confira se o **Escopo de memória** do bot não está **Isolado** quando outro agente deveria saber. Um provedor que não conecta deixa as notas integradas funcionando.`,
    },
  },
};
