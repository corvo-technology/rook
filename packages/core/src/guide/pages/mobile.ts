import type { GuidePage } from "../types.js";

export const mobile: GuidePage = {
  slug: "mobile",
  text: {
    en: {
      title: "Mobile and chat apps",
      summary: "The mobile app, reaching agents from WhatsApp and Telegram, and voice notes.",
      body: `## The mobile app

The mobile app talks to the same agents, routines, approvals and wiki as the web and desktop apps. It uses the phone's own menus, sheets and pickers. Approval cards appear in the chat. Some things are web or desktop only: the Store, Team, **Tasks**, saved credential management and the squad view.

## Settings on the phone

Open the settings for **Approvals**, **Models**, **Voice**, **Billing**, **Integrations** (apps and MCP servers) and **Messaging** (chat apps). **Approvals**, **Models** and **Voice** match the web settings of the same name.

## Reaching agents from chat apps

On web or desktop, connect WhatsApp or Telegram to an agent in the **Store** so people can write to it from the chat app. The number's owner talks to the agent in their own chat with themselves; anyone else writing to a customer-service number gets their own conversation. On WhatsApp, group chats are ignored. A run that starts from a chat app cannot change your agents.

## Voice notes

Voice notes from a linked chat app, and audio attached in the web chat, are turned into text before the agent runs; the audio stays attached. By default this happens on the computer running the app, or with the speech provider you chose under **Settings** › **Voice**. WAV and Ogg/Opus up to 8 MiB are transcribed; other formats are attached with a note. The mobile app does not transcribe audio yet.

## When it goes wrong

If a chat app stops answering, check that the number or bot is **Connected** and not **Paused**. A WhatsApp number that WhatsApp logged out shows as **Disconnected** and must be linked again.`,
    },
    "pt-BR": {
      title: "Celular e apps de chat",
      summary:
        "O app de celular, como falar com os agentes pelo WhatsApp e Telegram, e notas de voz.",
      body: `## O app de celular

O app de celular conversa com os mesmos agentes, rotinas, aprovações e wiki dos apps web e desktop. Ele usa os menus, planilhas e seletores do próprio telefone. Os cartões de aprovação aparecem no chat. Algumas coisas são só web ou desktop: a Loja, a Equipe, as **Tarefas**, o gerenciamento de credenciais salvas e a visão de squad.

## Configurações no celular

Abra as configurações de **Aprovações**, **Modelos**, **Voz**, **Cobrança**, **Integrações** (apps e servidores MCP) e **Mensagens** (apps de chat). **Aprovações**, **Modelos** e **Voz** correspondem às configurações web de mesmo nome.

## Falando com agentes por apps de chat

Na web ou no desktop, conecte o WhatsApp ou o Telegram a um agente na **Loja** para que as pessoas escrevam para ele pelo app de chat. O dono do número fala com o agente no próprio chat consigo mesmo; qualquer outra pessoa que escrever para um número de atendimento tem a própria conversa. No WhatsApp, chats em grupo são ignorados. Uma execução iniciada por um app de chat não pode mudar seus agentes.

## Notas de voz

Notas de voz de um app de chat conectado, e áudio anexado no chat web, viram texto antes de o agente rodar; o áudio continua anexado. Por padrão isso acontece no computador que roda o app, ou com o provedor de fala que você escolheu em **Configurações** › **Voz**. WAV e Ogg/Opus de até 8 MiB são transcritos; outros formatos são anexados com um aviso. O app de celular ainda não transcreve áudio.

## Quando algo dá errado

Se um app de chat parar de responder, confira se o número ou o bot está **Conectado** e não **Pausado**. Um número do WhatsApp que o WhatsApp desconectou aparece como **Desconectado** e precisa ser ligado de novo.`,
    },
  },
};
