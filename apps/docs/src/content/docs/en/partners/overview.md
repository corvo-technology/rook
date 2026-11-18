---
title: "Overview"
description: "Embedded or white label, and how revenue is shared."
sidebar:
  order: 1
---

A **partner** is a company that brings Rook agents to its own customers. Your backend calls a small API; each customer gets an isolated organization with one owner, a connector to your system and starter agents. No customer's data is visible to another.

## Two modes

| | Embedded | White label |
| --- | --- | --- |
| Where the customer uses Rook | Inside your product, through the SDK, signed in with your product's login | In a standalone app on your domain, with your brand |
| Example | An electronic health record that embeds the assistant | An agency selling its own agent system |
| Who sells the subscription | You, in your checkout | Rook, on your behalf, through Stripe Connect |
| How Rook is paid | A monthly invoice for Rook's share | An application fee on each charge |
| Availability | **Available** | <span class="soon">Coming soon</span> |

Embedded works today: [start with the quickstart](/en/partners/quickstart/). White label is being designed.

## How the money works

:::note[Figures are examples]
Prices, percentages and limits below are examples. Everything is configurable per partner; the real numbers are part of your agreement.
:::

- Rook sells from a **price list** (the catalog). Each plan includes AI credit.
- You earn a **commission** (example: 20%) of the catalog price and may add a **markup** that is entirely yours.
- Customers **always use the platform's AI**; there is no customer-owned AI key or subscription in partner flows.
- Rook's share never depends on what you charged: a discount you give comes out of your side.

Example: catalog price 100, commission 20%, markup 30.

| | Amount |
| --- | --- |
| The customer pays | 130 |
| Rook's share (`100 × 80%`) | 80 |
| Your commission (`100 × 20%`) | 20 |
| Your markup | 30 |
| **Your total** | **50** |

In embedded mode the customer pays you 130 and you owe Rook 80 on the monthly invoice. The catalog, subscription and top-up API that automates this is <span class="soon">coming soon</span>; see [Commerce](/en/partners/commerce/).

## Today, in the pilot

Today each customer has a monthly credit allowance (`allowanceCents`) that you set on each call, paid from the balance of the account that owns the partner. When it reaches 80% and when it runs out, Rook tells you through a [webhook](/en/partners/webhooks/).

## Becoming a partner

Talk to us at [rook.team](https://rook.team). We create your partner, you receive the key (shown once) and get the console under **Settings > Partnership**, where you import the agent template, set limits and pause customers.

A company with several products creates **one partner per product**: each has its own key, template, and Chief name and color, and customers never mix. They can all draw on the same balance.
