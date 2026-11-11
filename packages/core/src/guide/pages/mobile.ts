import type { GuidePage } from "../types.js";

export const mobile: GuidePage = {
  slug: "mobile",
  text: {
    en: {
      title: "Mobile and chat apps",
      summary: "The mobile app, reaching agents from WhatsApp and Telegram, and voice notes.",
      body: `## The mobile app

The mobile app talks to the same agents, routines, approvals and wiki as the web and desktop apps. It uses the phone's own menus, sheets and pickers. Approval cards appear in the chat. Some things are web or desktop only: saved credential management and the squad lanes view.

## Settings on the phone

Open the settings for **Approvals**, **Models**, **Connections**, **Voice**, **Billing** and the **Space**. They match the web settings of the same name.

## Reaching agents from chat apps

In the **Store**, connect WhatsApp or Telegram to an agent so people can write to it from the chat app. The number's owner talks to the agent with full access; anyone else gets their own conversation. On WhatsApp, group chats are ignored. A run that starts from a chat app cannot change your agents or ask you for approval.

## Voice notes

Voice notes sent to an agent are transcribed first. A voice provider that transcribes is used when you chose one; the desktop app can also transcribe on its own computer with a downloaded speech model. If a note cannot be transcribed, the agent is told so and you are told once.

## When it goes wrong

If a chat app stops answering, check that the number or bot is **Connected** and not **Paused**. A WhatsApp number that WhatsApp logged out shows as **Disconnected** and must be linked again.`,
    },
    "pt-BR": {
      title: "Celular e apps de chat",
      summary:
        "O app de celular, como falar com os agentes pelo WhatsApp e Telegram, e notas de voz.",
      body: `## O app de celular

O app de celular conversa com os mesmos agentes, rotinas, aprovações e wiki dos apps web e desktop. Ele usa os menus, planilhas e seletores do próprio telefone. Os cartões de aprovação aparecem no chat. Algumas coisas são só web ou desktop: o gerenciamento de credenciais salvas e a visão em raias do squad.

## Configurações no celular

Abra as configurações de **Aprovações**, **Modelos**, **Conexões**, **Voz**, **Cobrança** e do **Espaço**. Elas correspondem às configurações web de mesmo nome.

## Falando com agentes por apps de chat

Na **Loja**, conecte o WhatsApp ou o Telegram a um agente para que as pessoas escrevam para ele pelo app de chat. O dono do número fala com o agente com acesso total; qualquer outra pessoa tem a própria conversa. No WhatsApp, chats em grupo são ignorados. Uma execução iniciada por um app de chat não pode mudar seus agentes nem pedir aprovação a você.

## Notas de voz

Notas de voz enviadas a um agente são transcritas primeiro. Usa-se um provedor de voz que transcreve quando você escolheu um; o app desktop também pode transcrever no próprio computador com um modelo de fala baixado. Se uma nota não pode ser transcrita, o agente é avisado e você é avisado uma vez.

## Quando algo dá errado

Se um app de chat parar de responder, confira se o número ou o bot está **Conectado** e não **Pausado**. Um número do WhatsApp que o WhatsApp desconectou aparece como **Desconectado** e precisa ser ligado de novo.`,
    },
  },
};
