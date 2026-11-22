import type { GuidePage } from "../types.js";

export const limits: GuidePage = {
  slug: "limits",
  text: {
    en: {
      title: "Limits and usage",
      summary: "Provider quota windows, usage by agent and credits.",
      body: `## Provider limits

Subscription providers limit use by time windows, such as a **5-hour window** and a **Week**. When a window fills up, replies from models on that subscription fail until it starts over. Rook can tell which windows are nearly full; ask it. A failed reply names the limit that was reached.

## Usage

**Settings** › **Usage** shows what was used over a period, **By agent**, with the tokens and the **Cost** where it is known.

## Billing

Where the app has billing, **Settings** › **Billing** shows the plan and **Manage** opens it. A server you run yourself has no billing unless you set a payment provider up.

## When it goes wrong

If replies fail because a limit was reached, wait for the window to start over, pick another model with **Change model**, or connect another provider (see the models page). A rate-limit error is temporary: try again in a moment.`,
    },
    "pt-BR": {
      title: "Limites e uso",
      summary: "Janelas de cota dos provedores, uso por agente e créditos.",
      body: `## Limites dos provedores

Provedores por assinatura limitam o uso por janelas de tempo, como uma **Janela de 5 horas** e uma **Semana**. Quando uma janela enche, as respostas dos modelos dessa assinatura falham até ela recomeçar. O Rook sabe dizer quais janelas estão quase cheias; pergunte a ele. Uma resposta que falhou diz qual limite foi atingido.

## Uso

**Configurações** › **Uso** mostra o que foi usado em um período, **Por agente**, com os tokens e o **Custo** quando conhecido.

## Cobrança

Onde o app tem cobrança, **Configurações** › **Cobrança** mostra o plano e **Gerenciar** o abre. Um servidor que você mesmo hospeda não tem cobrança, a menos que você configure um provedor de pagamento.

## Quando algo dá errado

Se as respostas falham por um limite atingido, espere a janela recomeçar, escolha outro modelo com **Trocar modelo** ou conecte outro provedor (veja a página de modelos). Um erro de limite de requisições é temporário: tente de novo em instantes.`,
    },
  },
};
