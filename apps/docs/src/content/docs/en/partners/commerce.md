---
title: "Commerce"
description: "Catalog, subscriptions, top-ups, balance and usage. Coming soon."
sidebar:
  order: 9
  badge:
    text: Soon
    variant: caution
---

:::caution[Coming soon]
This page describes the commerce API, **not yet released**. Formats may change before launch, and figures are examples. Today each customer's credit allowance is set with `allowanceCents` on [`PUT /tenants`](/en/partners/api/).
:::

For partners on the "commerce" billing model, the API gains routes to sell plans and top-ups. All accept an `Idempotency-Key` (required on those that move money), use the currency's **minor units** (cents) and keep the `401` and `404` rules of the [API](/en/partners/api/). A partner has one currency, set by its country: BRL in Brazil, USD elsewhere.

## Catalog

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

`priceMinor` is what you should charge (advice in embedded mode, a rule in white label).

## Subscription

```http
PUT /tenants/{externalTenantId}/subscription
Idempotency-Key: <uuid>
{ "plan": "team", "status": "active",
  "currentPeriodStart": "2026-11-01T00:00:00Z", "currentPeriodEnd": "2026-12-01T00:00:00Z",
  "chargedMinor": 54900 }
```

`status` is `trialing`, `active`, `past_due` or `canceled`. A new period grants the plan's credit once. An unknown plan answers `422 unknown_plan`.

## Top-up

```http
POST /tenants/{externalTenantId}/topups
Idempotency-Key: <your payment id>
{ "pack": "pack_s", "quantity": 1, "paidMinor": 5500, "externalPaymentId": "pay_123" }
```

Repeating the same key returns the original answer; a different body under the same key is `409 idempotency_conflict`.

## Balance and usage

```http
GET /tenants/{externalTenantId}/balance
GET /tenants/{externalTenantId}/usage?period=2026-11
```

The balance separates plan credit (which expires at period end) from top-up credit. Usage carries **totals and dates only**, never prompts, outputs, models or customer content.

## Webhook events

`subscription.updated`, `subscription.lapsed`, `credit.granted`, `credit.expired`, `invoice.issued` and `payout.paid`, with the same [signing](/en/partners/webhooks/) as the rest.

## Credits for embedded partners

In embedded mode your customers belong to you: you create their accounts with the API, show Rook only to those who pay you, and charge them however you like. Rook never bills those customers. Only you pay Rook, a monthly **partner plan** with included credits plus **top-ups**. Everything your customers use is debited from **one fund** of yours, in credits.

What is debited:

- tokens of the models Rook provides, each model at its own rate;
- platform voice (calls and transcription);
- computer minutes;
- storage above an allowance.

A customer who connects **their own model** (their own key, a local model or their own coding-agent plan) uses no credits for it. Computer minutes and storage are still debited.

Controls you set in the [partner console](/en/partners/central/):

- a monthly **credit limit** per customer (optional). At the limit the customer stops using Rook-provided AI until you raise it or the next period starts, and you get `customer.credit_limit_reached`;
- a list of **allowed models** (optional), which applies only to Rook-provided models;
- **auto top-up**: when the fund falls under the amount you set, open a top-up;
- usage per customer, by resource and model;
- low-balance and limit alerts by email and in the app (and, to automate, by optional [webhook](/en/partners/webhooks/)).

Prices, included credits, margins and expiry: talk to us.
