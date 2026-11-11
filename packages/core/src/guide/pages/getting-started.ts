import type { GuidePage } from "../types.js";

export const gettingStarted: GuidePage = {
  slug: "getting-started",
  text: {
    en: {
      title: "Getting started",
      summary: "The first steps in the app, the Chief, and how the first agents get added.",
      body: `## Setup

The first time, the app asks a few things once: how you will use it, a name for your **Workspace**, a model (**Connect a model**), where bots run (**Where should bots run?**) and what your bots should help with. The name can be changed later in **Settings** › **Space**.

## The Chief

You start with the Chief, the agent you talk to first. Tell it what you need. It picks the right agent, hands the work over with a full brief and brings the answer back, saying which agent did it. It answers small things itself.

## Adding agents

With no other agents yet, the Chief suggests one to three agents from the **Store** and adds the ones you accept. If an agent needs an app that is not connected, the Chief asks for approval in the chat; connecting is done in the **Store** under **Apps**. You can also browse the **Store** under **Agents** and use **Add** yourself.

## Where things are

- **Team**: your agents and groups.
- **Routines**: work that runs on its own.
- **Board**: tickets and who works on them.
- **Wiki**: what the team knows.
- **Settings**: models, memory, connections, approvals and usage.

## When it goes wrong

If no model is connected, nothing can answer: open **Settings** › **Models** and connect one. If setup could not finish, use **Try again**.`,
    },
    "pt-BR": {
      title: "Primeiros passos",
      summary: "Os primeiros passos no app, o Chefe e como os primeiros agentes são adicionados.",
      body: `## Configuração

Na primeira vez, o app pergunta algumas coisas uma só vez: como você vai usá-lo, um nome para o seu **Espaço**, um modelo (**Conectar um modelo**), onde os bots devem ser executados (**Onde os bots devem ser executados?**) e com o que seus bots devem ajudar. O nome pode ser mudado depois em **Configurações** › **Espaço**.

## O Chefe

Você começa com o Chefe, o agente com quem fala primeiro. Diga o que precisa. Ele escolhe o agente certo, passa o trabalho com um briefing completo e traz a resposta de volta, dizendo qual agente fez. Coisas pequenas ele mesmo responde.

## Adicionando agentes

Sem outros agentes ainda, o Chefe sugere de um a três agentes da **Loja** e adiciona os que você aceitar. Se um agente precisa de um app que não está conectado, o Chefe pede aprovação no chat; a conexão é feita na **Loja**, em **Apps**. Você também pode ver a **Loja** em **Agentes** e usar **Adicionar** por conta própria.

## Onde ficam as coisas

- **Equipe**: seus agentes e grupos.
- **Rotinas**: trabalho que roda sozinho.
- **Quadro**: tickets e quem trabalha neles.
- **Wiki**: o que a equipe sabe.
- **Configurações**: modelos, memória, conexões, aprovações e uso.

## Quando algo dá errado

Se nenhum modelo estiver conectado, nada consegue responder: abra **Configurações** › **Modelos** e conecte um. Se a configuração não terminou, use **Tentar novamente**.`,
    },
  },
};
