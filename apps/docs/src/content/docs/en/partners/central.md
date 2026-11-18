---
title: "Partner console"
description: "Customers, credits, integration and portfolio agents, inside your Rook."
sidebar:
  order: 4
---

The **partner console** lives inside your own Rook, under **Settings > Partnership**, and appears once Rook approves your request. Using it needs the permission to manage the partner, which owners and the default Admin role have.

## What is in it

- **Overview.** Customers, usage and what needs you.
- **Customers.** Each customer with numbers and states, never conversations. You can pause, resume, give credit and **open as support**: a one-use entry, valid for a minute and audited.
- **Credits and invoices** (embedded). The fund, the partner plan, usage per customer, resource and model, top-ups and invoices.
- **Prices and revenue** (referral). Your markup per plan and revenue by month.
- **Integration.** Key prefix, webhook URL and key rotation (the new key is shown once).
- **Agent template.** The starter agents every new customer receives.

## Credit controls (embedded)

- **Monthly limit per customer.** At the limit the customer stops using Rook-provided AI until you raise it or the month turns. You get `customer.credit_limit_reached`.
- **Allowed models.** Applies only to Rook-provided models; empty allows all. A model outside the list is refused and disappears from the customer's picker. Models the customer connected on their own stay available.
- **Auto top-up.** When the fund falls under the amount you set, Rook opens a top-up through checkout.
- **Alerts.** A customer's limit reached, low fund, auto top-up, invoice issued, payment failed and connector down reach you by email and in the app. To automate in your own system, there are optional [webhooks](/en/partners/webhooks/).

These controls are set in the console; the public partner API has no fields for them yet.

## Portfolio agents

Two installable agents work your portfolio through the **Partnership** connection:

- **Portfolio Manager.**
- **Customer Success.**

They read customers, usage, revenue and invoices. Any action (giving credit, pausing, resuming, changing a limit) asks for **your approval every time**, whatever the agent's approval mode. Results are numbers, states and names, never conversations.

## White label

<span class="soon">Coming soon</span>. Customers will use the product under your brand, on your domain, with your emails. There is no documented API yet.
