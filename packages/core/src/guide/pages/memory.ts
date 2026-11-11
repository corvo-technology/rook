import type { GuidePage } from "../types.js";

export const memory: GuidePage = {
  slug: "memory",
  text: {
    en: {
      title: "Memory",
      summary:
        "What agents remember, shared notes and open work, and connecting a memory provider.",
      body: `## What agents remember

Agents keep notes between conversations. Open **Settings** › **Memory** to see and edit what is kept.

- **Shared memory**: notes every agent in the space reads and keeps up to date.
- **Open work**: items still to do, which you can add yourself with **Add open work**.
- **Skills**: saved how-tos, which you can edit or delete.

## Shared or isolated

A bot's **Memory scope** is **Shared** or **Isolated**. **Shared** lets it read the space's notes; **Isolated** keeps its notes to itself. **Default scope** sets the choice for new bots, and a bot can override it in its own settings.

## Memory providers

By default memory is **Built-in**. A space can instead **Connect** an outside memory provider, as a plugin, in the cloud or on a server you run. The access level is **Recall and write** or **Recall only**. **Disconnect** returns to the built-in memory.

## Memory and the wiki

Memory is private working notes. Pages the whole team should keep live in the wiki; see the wiki page.

## When it goes wrong

If an agent forgets something, check **Shared memory** for whether it was kept, and that the bot's scope is not **Isolated** if another agent should know it. A provider that fails to connect keeps the built-in memory working.`,
    },
    "pt-BR": {
      title: "Memória",
      summary:
        "O que os agentes lembram, notas compartilhadas e trabalho aberto, e como conectar um provedor de memória.",
      body: `## O que os agentes lembram

Os agentes guardam notas entre conversas. Abra **Configurações** › **Memória** para ver e editar o que foi guardado.

- **Memória compartilhada**: notas que todos os agentes do espaço leem e mantêm atualizadas.
- **Trabalho aberto**: itens ainda por fazer, que você mesmo pode adicionar com **Adicionar trabalho pendente**.
- **Habilidades**: roteiros salvos, que você pode editar ou excluir.

## Compartilhada ou isolada

O **Escopo de memória** de um bot é **Compartilhado** ou **Isolado**. **Compartilhado** deixa o bot ler as notas do espaço; **Isolado** mantém as notas só para ele. **Escopo padrão** define a escolha para bots novos, e um bot pode mudar isso nas próprias configurações.

## Provedores de memória

Por padrão a memória é **Integrado**. Um espaço pode, em vez disso, **Conectar** um provedor de memória externo, como plugin, na nuvem ou em um servidor seu. O nível de acesso é **Lembrar e escrever** ou **Só lembrar**. **Desconectar** volta para a memória integrada.

## Memória e a wiki

A memória são notas de trabalho privadas. Páginas que a equipe toda deve manter ficam na wiki; veja a página da wiki.

## Quando algo dá errado

Se um agente esqueceu algo, veja em **Memória compartilhada** se foi guardado e se o escopo do bot não está **Isolado** quando outro agente deveria saber. Um provedor que não conecta deixa a memória integrada funcionando.`,
    },
  },
};
