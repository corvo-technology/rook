import type { GuidePage } from "../types.js";

export const gettingStarted: GuidePage = {
  slug: "getting-started",
  text: {
    en: {
      title: "Getting started",
      summary: "The first steps in the app, the Chief, and how the first agents get added.",
      body: `## Setup

The first time, the app asks a few things once: how you will use it and what your bots should help with, a name for your **Workspace**, and a model (**Connect a model**) when none is connected. The desktop app also asks where bots run (**Where should bots run?**). The space name can be changed later in the space's settings.

## The Chief

You start with the Chief, the agent you talk to first. Tell it what you need. It picks the right agent, hands the work over with a full brief and brings the answer back, saying which agent did it. It answers small things itself.

## Adding agents

With no other agents yet, the Chief suggests one to three agents from the **Store** and adds the ones you accept. If an agent needs an app that is not connected, the Chief asks for access with a card in the chat; apps are connected in the **Store** under **Apps**. You can also open the **Store**, go to **Agents** and use **Add** yourself.

## Where things are

- **Team**: your agents and groups.
- **Routines**: work that runs on its own.
- **Tasks**: tickets and who works on them, where the deployment turns it on.
- **Wiki**: what the team knows.
- **Settings**: models, voice, approvals, memory and usage.

## When it goes wrong

If no model is connected, nothing can answer: open **Settings** › **Models** and connect one. If setup could not finish, use **Try again**.`,
    },
    "pt-BR": {
      title: "Primeiros passos",
      summary: "Os primeiros passos no app, o Chefe e como os primeiros agentes são adicionados.",
      body: `## Configuração

Na primeira vez, o app pergunta algumas coisas uma só vez: como você vai usá-lo e com o que seus bots devem ajudar, um nome para o seu **Espaço** e um modelo (**Conectar um modelo**) quando nenhum está conectado. O app desktop também pergunta onde os bots são executados (**Onde os bots devem ser executados?**). O nome do espaço pode ser mudado depois nas configurações do espaço.

## O Chefe

Você começa com o Chefe, o agente com quem fala primeiro. Diga o que precisa. Ele escolhe o agente certo, passa o trabalho com um briefing completo e traz a resposta de volta, dizendo qual agente fez. Coisas pequenas ele mesmo responde.

## Adicionando agentes

Sem outros agentes ainda, o Chefe sugere de um a três agentes da **Loja** e adiciona os que você aceitar. Se um agente precisa de um app que não está conectado, o Chefe pede acesso com um cartão no chat; os apps são conectados na **Loja**, em **Apps**. Você também pode abrir a **Loja**, ir em **Agentes** e usar **Adicionar** por conta própria.

## Onde ficam as coisas

- **Equipe**: seus agentes e grupos.
- **Rotinas**: trabalho que roda sozinho.
- **Tarefas**: tickets e quem trabalha neles, onde a implantação ativa.
- **Wiki**: o que a equipe sabe.
- **Configurações**: modelos, voz, aprovações, memória e uso.

## Quando algo dá errado

Se nenhum modelo estiver conectado, nada consegue responder: abra **Configurações** › **Modelos** e conecte um. Se a configuração não terminou, use **Tentar novamente**.`,
    },
  },
};
