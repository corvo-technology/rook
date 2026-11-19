---
title: "Test mode"
description: "Build and test the integration end to end with no credit spent and no subscription: test key, limits and how to go live."
sidebar:
  order: 10
---

Test mode lets you build and check the whole integration before you sell anything. Nothing done with the test key is billed, counted as revenue or taken from your fund's credit.

## The test key

In **Settings > Partnership > Integration**, in the **Test** section, use **Create test key**. The key starts with `cpk_test_` and is shown once; keep it on your backend, like the live key. **New key** replaces the test key without touching the live one: the old one stops working at once.

Use the test key in the same header and on the same addresses:

```bash
curl -X PUT https://YOUR-ROOK/api/partner/v1/tenants/test-shop-1 \
  -H "Authorization: Bearer cpk_test_..." \
  -H "Content-Type: application/json" \
  -d '{ "name": "Test shop" }'
```

The response carries `"test": true`.

## What changes in test

- **Separate data.** The test key only sees and changes test customers; the live key only live ones. Using the id of a customer of the other mode answers `404`, and creating a customer under an id that exists in the other mode answers `409` with `{ "error": "tenant_mode" }`. Use ids of their own for tests.
- **Nothing is billed.** Test customers use no credit, need no subscription and are left out of revenue, usage, limits, invoices and customer counts. `allowanceCents` is ignored.
- **A cheap model and a daily cap.** Test agents always run on the platform's fast model. Each partner has a daily cap of model calls, counted across all its test customers (300 per UTC day by default). When it is used, the run stops with a notice and resumes the next day. The Rook team can adjust the cap.
- **Visibly marked.** The embedded assistant shows a **Test** badge in its bar, and the console lists test customers apart (the **Test** button in **Customers**).

## Commerce in test

For partners billed through Rook (`billingModel: commerce`), commerce calls made with the test key are **simulated**: `PUT /subscription`, `POST /topups`, `POST /refunds`, `GET /balance` and `GET /usage` check the request (the plan and pack must exist in the catalog; the period must be valid) and answer in the live shape, with `"test": true`. No invoice, payment or real credit is created. A test customer uses the assistant without a plan.

A test subscription set to `past_due` or `canceled` sends `subscription.lapsed` to the test webhook, so you can see how your system reacts.

## Test webhooks

In **Integration > Test** you set an `https` test URL. Notices about test customers go **only** there, with `"test": true` in the body and the `X-Rook-Test: true` header, signed like live ones. With no test URL nothing is sent, and they never reach the live webhook or the email alerts.

## Clear test data

**Clear test data** deletes every test customer of the partner, with its agents, files and conversations. Live customers are never touched. It asks first and is audited.

## Going live

1. Swap the test key for the live key on your backend (everything else is the same: same addresses, same format).
2. Use real customer ids; test ones stay apart and can be deleted with **Clear test data**.
3. Check the agent template, the live webhook and, if it applies, the catalog and prices.

The Rook team follows each partner's test usage and sets the daily cap.
