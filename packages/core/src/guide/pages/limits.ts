import type { GuidePage } from "../types.js";

export const limits: GuidePage = {
  slug: "limits",
  text: {
    en: {
      title: "Limits and usage",
      summary: "Provider quota windows, the context meter, usage by agent and credits.",
      body: `## Provider limits

Subscription providers limit use by time windows, such as a **5-hour window** and a **Week**. When a window fills up, replies from models on that subscription fail until it starts over. The Chief can tell which windows are nearly full; ask it. A failed reply names the limit that was reached.

## Context

The **Context** meter in a chat shows how full the conversation is for the model. When it is nearly full, use **Compress context** to shrink the older part, or start a new chat.

## Usage

**Settings** › **Usage** shows what was used over a period, **By agent**, with the tokens and the **Cost** where it is known.

## Billing

Where the app has billing, **Settings** › **Billing** shows the plan and **Manage** opens it. A server you run yourself has no billing unless you set a payment provider up.

## When it goes wrong

If replies fail because a limit was reached, wait for the window to start over, pick another model with **Change model**, or connect another provider (see the models page). A rate-limit error is temporary: try again in a moment.`,
    },
    "pt-BR": {
      title: "Limites e uso",
      summary: "Janelas de cota dos provedores, o medidor de contexto, uso por agente e créditos.",
      body: `## Limites dos provedores

Provedores por assinatura limitam o uso por janelas de tempo, como uma **Janela de 5 horas** e uma **Semana**. Quando uma janela enche, as respostas dos modelos dessa assinatura falham até ela recomeçar. O Chefe sabe dizer quais janelas estão quase cheias; pergunte a ele. Uma resposta que falhou diz qual limite foi atingido.

## Contexto

O medidor de **Contexto** em um chat mostra quão cheia está a conversa para o modelo. Quando está quase cheio, use **Comprimir contexto** para encolher a parte mais antiga, ou comece um novo chat.

## Uso

**Configurações** › **Uso** mostra o que foi usado em um período, **Por agente**, com os tokens e o **Custo** quando conhecido.

## Cobrança

Onde o app tem cobrança, **Configurações** › **Cobrança** mostra o plano e **Gerenciar** o abre. Um servidor que você mesmo hospeda não tem cobrança, a menos que você configure um provedor de pagamento.

## Quando algo dá errado

Se as respostas falham por um limite atingido, espere a janela recomeçar, escolha outro modelo com **Trocar modelo** ou conecte outro provedor (veja a página de modelos). Um erro de limite de requisições é temporário: tente de novo em instantes.`,
    },
  },
};
