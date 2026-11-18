---
title: "Comércio"
description: "Catálogo, assinaturas, recargas, saldo e uso. Em breve."
sidebar:
  order: 9
  badge:
    text: Em breve
    variant: caution
---

:::caution[Em breve]
Esta página descreve a API de comércio **ainda não lançada**. Os formatos podem mudar até o lançamento, e os valores são exemplos. Hoje a cota de crédito de cada cliente é definida com `allowanceCents` no [`PUT /tenants`](/partners/api/).
:::

Para parceiros com o modelo de cobrança "comércio", a API ganha rotas para vender planos e recargas. Todas aceitam `Idempotency-Key` (obrigatória nas que movem dinheiro), usam **unidades menores** da moeda (centavos) e mantêm as regras de `401` e `404` da [API](/partners/api/). O parceiro tem uma moeda só, definida pelo país: BRL no Brasil, USD nos demais.

## Catálogo

```http
GET /catalog
```

```json
{
  "currency": "BRL",
  "plans": [{ "key": "team", "baseMinor": 49900, "markupMinor": 5000, "priceMinor": 54900, "creditMinor": 20000 }],
  "packs": [{ "key": "pack_s", "baseMinor": 5000, "markupMinor": 500, "priceMinor": 5500, "creditMinor": 5000 }]
}
```

`priceMinor` é o que você deve cobrar (um conselho no modo embutido, uma regra na marca própria).

## Assinatura

```http
PUT /tenants/{externalTenantId}/subscription
Idempotency-Key: <uuid>
{ "plan": "team", "status": "active",
  "currentPeriodStart": "2026-11-01T00:00:00Z", "currentPeriodEnd": "2026-12-01T00:00:00Z",
  "chargedMinor": 54900 }
```

`status` é `trialing`, `active`, `past_due` ou `canceled`. Um período novo concede o crédito do plano uma única vez. Um plano desconhecido responde `422 unknown_plan`.

## Recarga

```http
POST /tenants/{externalTenantId}/topups
Idempotency-Key: <id do seu pagamento>
{ "pack": "pack_s", "quantity": 1, "paidMinor": 5500, "externalPaymentId": "pay_123" }
```

Repetir a mesma chave devolve a resposta original; outro corpo com a mesma chave é `409 idempotency_conflict`.

## Saldo e uso

```http
GET /tenants/{externalTenantId}/balance
GET /tenants/{externalTenantId}/usage?period=2026-11
```

O saldo separa o crédito do plano (que expira no fim do período) do crédito de recarga. O uso traz **só totais e datas**, nunca prompts, respostas, modelos ou conteúdo do cliente.

## Eventos de webhook

`subscription.updated`, `subscription.lapsed`, `credit.granted`, `credit.expired`, `invoice.issued` e `payout.paid`, com a mesma [assinatura](/partners/webhooks/) dos demais.

## Créditos para parceiros embutidos

No modo embutido seus clientes são seus: você cria as contas deles pela API, mostra o Rook só a quem paga você e cobra como quiser. O Rook nunca cobra esses clientes. Só você paga o Rook, com um **plano de parceiro** mensal que inclui créditos, mais **recargas**. Tudo o que seus clientes usam sai de **um fundo** seu, em créditos.

O que é debitado:

- tokens dos modelos que o Rook fornece, cada modelo na sua tarifa;
- voz da plataforma (ligações e transcrição);
- minutos de computador;
- armazenamento acima de uma franquia.

Um cliente que conecta **o próprio modelo** (a própria chave, um modelo local ou o próprio plano de agente de código) não gasta créditos com ele. Minutos de computador e armazenamento continuam sendo debitados.

Controles que você define na [Central do parceiro](/partners/central/):

- um **limite mensal de créditos** por cliente (opcional). No limite o cliente deixa de usar a IA fornecida pelo Rook até você aumentar ou o próximo período começar, e você recebe `customer.credit_limit_reached`;
- uma lista de **modelos permitidos** (opcional), que vale só para os modelos fornecidos pelo Rook;
- **recarga automática**: quando o fundo ficar abaixo do valor que você definir, abrir uma recarga;
- uso por cliente, por recurso e modelo;
- avisos de saldo baixo e de limite por e-mail e no app (e, se quiser automatizar, por [webhook](/partners/webhooks/) opcional).

Preços, créditos incluídos, margens e validade: fale com a gente.
