import type { GuidePage } from "../types.js";

export const agents: GuidePage = {
  slug: "agents",
  text: {
    en: {
      title: "Agents",
      summary:
        "Adding agents from the Store, a bot's settings and instructions, and letting a bot manage others.",
      body: `## Adding an agent

Open the **Store**, go to **Agents** and use **Add** on one. Ready-made agents arrive with their skills and tell you which apps they still need. To make your own, use **New bot**, give it a **Name** and say what it is for.

## A bot's settings

Open a bot's settings to change its name, its **Instructions**, its model and its voice. Under **Advanced**:

- **Manage the bots it creates**: lets the bot create groups, rewrite the instructions of bots it created, pick their model and schedule them. On by default, and it only works in runs you started.
- **Route work to squads**: lets the bot hand a request to one of your groups.
- **Credentials**: saved logins and keys for that bot, listed without their values.

## Changing a bot's instructions

When a bot proposes new instructions, a card shows the whole text. Nothing changes until you approve it.

## When it goes wrong

If a bot cannot use an app, check **Agents that can use it** in the app's settings under **Connections**. If a bot has no model of its own it uses the space default; see the models page.`,
    },
    "pt-BR": {
      title: "Agentes",
      summary:
        "Adicionar agentes da Loja, as configurações e instruções de um bot, e deixar um bot gerenciar outros.",
      body: `## Adicionando um agente

Abra a **Loja**, vá em **Agentes** e use **Adicionar** em um deles. Agentes prontos chegam com suas habilidades e dizem quais apps ainda precisam. Para criar o seu, use **Novo bot**, dê um **Nome** e diga para que ele serve.

## Configurações de um bot

Abra as configurações de um bot para mudar o nome, as **Instruções**, o modelo e a voz. Em **Avançado**:

- **Gerenciar os bots que cria**: deixa o bot criar grupos, reescrever as instruções dos bots que ele criou, escolher o modelo deles e agendá-los. Vem ligado por padrão e só funciona em execuções que você iniciou.
- **Encaminhar trabalho para squads**: deixa o bot passar um pedido para um dos seus grupos.
- **Credenciais**: logins e chaves salvos daquele bot, listados sem os valores.

## Mudando as instruções de um bot

Quando um bot propõe novas instruções, um cartão mostra o texto inteiro. Nada muda até você aprovar.

## Quando algo dá errado

Se um bot não consegue usar um app, confira **Agentes que podem usar** nas configurações do app, em **Conexões**. Se um bot não tem modelo próprio, ele usa o padrão do espaço; veja a página de modelos.`,
    },
  },
};
