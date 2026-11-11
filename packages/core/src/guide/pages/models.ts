import type { GuidePage } from "../types.js";

export const models: GuidePage = {
  slug: "models",
  text: {
    en: {
      title: "Models",
      summary:
        "Connecting a model provider, the space default, a bot's own model and the model roles.",
      body: `## Connecting a provider

Open **Settings** › **Models**. Under **Providers**, use **Add provider** and sign in, paste an API key, or give the address of a compatible or local server. **Find models** lists what a server offers. **Disconnect** removes a connection from every space. No hosted provider is required.

## The default and a bot's own model

**Main model** is the space default. A bot with no model of its own uses it. To give one bot a different model, open that bot's settings, go to **Advanced** and pick a **Model**. **Bot models** lists the bots that have their own, and **Use space default** switches all of them back. The Chief can change a bot's model too, through a card you apply.

## Thinking

**Thinking** sets how much a model reasons before it answers, for each model role and for a bot under **Advanced**. For a model on a server you added by address, **Reasoning effort** sets the level. More thinking is slower and uses more of the provider's limit.

## Other roles

Smaller jobs can use their own model: **Light tasks model** for quick work, **Routing model** for deciding who handles a request, and **Approval model** for **Auto** approvals. Each falls back to a default when unset.

## Fallbacks

**Add fallback** names a model to try when the first cannot answer.

## When it goes wrong

A failed reply shows the reason and a button to fix it, such as **Change model**, **Replace key** or **Connect a model**. A model that cannot read images shows **Can't read images**. See the limits page when a provider's limit is reached.`,
    },
    "pt-BR": {
      title: "Modelos",
      summary:
        "Conectar um provedor de modelos, o padrão do espaço, o modelo próprio de um bot e as funções dos modelos.",
      body: `## Conectando um provedor

Abra **Configurações** › **Modelos**. Em **Provedores**, use **Adicionar provedor** e entre na conta, cole uma chave de API ou informe o endereço de um servidor compatível ou local. **Encontrar modelos** lista o que um servidor oferece. **Desconectar** remove a conexão de todos os espaços. Nenhum provedor hospedado é obrigatório.

## O padrão e o modelo próprio de um bot

**Modelo principal** é o padrão do espaço. Um bot sem modelo próprio usa esse. Para dar outro modelo a um bot, abra as configurações dele, vá em **Avançado** e escolha um **Modelo**. **Modelos dos bots** lista os bots que têm modelo próprio, e **Usar o padrão do espaço** volta todos ao padrão. O Chefe também pode mudar o modelo de um bot, por um cartão que você aplica.

## Raciocínio

**Pensando** define quanto um modelo raciocina antes de responder, em cada função de modelo e, para um bot, em **Avançado**. Para um modelo em um servidor adicionado por endereço, **Esforço de raciocínio** define o nível. Mais raciocínio é mais lento e gasta mais do limite do provedor.

## Outras funções

Tarefas menores podem usar um modelo próprio: **Modelo para tarefas leves** para trabalho rápido, **Modelo de roteamento** para decidir quem cuida de um pedido e **Modelo de aprovação** para aprovações **Auto**. Cada um volta a um padrão quando não definido.

## Alternativos

**Adicionar alternativo** indica um modelo para tentar quando o primeiro não consegue responder.

## Quando algo dá errado

Uma resposta que falhou mostra o motivo e um botão para corrigir, como **Trocar modelo**, **Substituir chave** ou **Conectar um modelo**. Um modelo que não lê imagens mostra **Não pode ler imagens**. Veja a página de limites quando o limite de um provedor é atingido.`,
    },
  },
};
