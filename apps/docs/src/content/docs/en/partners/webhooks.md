---
title: "Webhooks"
description: "Credit notices and how to verify the signature."
sidebar:
  order: 5
---

Rook calls a URL of yours when a customer has used **80%** of the month's credit and again when it **runs out**. The URL must be `https` and public; it and the signing secret are configured with the Rook team, who can also replace the secret on request (the old one stops matching).

## The notice

A `POST` with a JSON body, sent **once per customer, type and month**:

```json
{
  "id": "evt_...",
  "type": "tenant.allowance_low",
  "createdAt": "2026-11-20T12:00:00.000Z",
  "externalTenantId": "shop-1",
  "period": "2026-11",
  "grantedCents": 1500,
  "usedCents": 1260,
  "remainingCents": 240
}
```

`type` is `tenant.allowance_low` or `tenant.allowance_exhausted`. The body never carries a key, a token or customer content.

| Header | Value |
| --- | --- |
| `X-Rook-Event` | The `type`. |
| `X-Rook-Delivery` | The `id`, for de-duplicating. |
| `X-Rook-Timestamp` | Seconds since the epoch. |
| `X-Rook-Signature` | `sha256=<hex>`: HMAC-SHA256, keyed by the secret, of `<timestamp>.<raw body>`. |

## Verify the signature

Compute the HMAC over the **raw body** (before parsing the JSON), compare in constant time and **reject timestamps older than a few minutes**.

```js title="Node.js (Express)"
import crypto from "node:crypto";
import express from "express";

const app = express();

app.post("/rook/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const timestamp = req.get("X-Rook-Timestamp") ?? "";
  const received = req.get("X-Rook-Signature") ?? "";
  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", process.env.ROOK_WEBHOOK_SECRET)
      .update(`${timestamp}.${req.body.toString("utf8")}`)
      .digest("hex");

  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300;
  const valid =
    received.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  if (!fresh || !valid) return res.sendStatus(401);

  const event = JSON.parse(req.body);
  // de-duplicate on req.get("X-Rook-Delivery")
  console.log(event.type, event.externalTenantId);
  res.sendStatus(200);
});
```

```python title="Python (Flask)"
import hashlib, hmac, os, time
from flask import Flask, request, abort

app = Flask(__name__)
SECRET = os.environ["ROOK_WEBHOOK_SECRET"].encode()

@app.post("/rook/webhook")
def rook_webhook():
    timestamp = request.headers.get("X-Rook-Timestamp", "")
    received = request.headers.get("X-Rook-Signature", "")
    body = request.get_data()  # raw body
    expected = "sha256=" + hmac.new(
        SECRET, f"{timestamp}.".encode() + body, hashlib.sha256
    ).hexdigest()

    fresh = timestamp.isdigit() and abs(time.time() - int(timestamp)) < 300
    if not fresh or not hmac.compare_digest(received, expected):
        abort(401)

    event = request.get_json()
    # de-duplicate on request.headers["X-Rook-Delivery"]
    print(event["type"], event["externalTenantId"])
    return "", 200
```

## Delivery and retries

Answer any `2xx` once handled. Anything else, or no answer within ten seconds, is retried with backoff (up to 8 attempts), and a notice still not delivered is queued again for up to three days. Make your handler **idempotent**: use `X-Rook-Delivery`.

## Coming soon

With the [commerce API](/en/partners/commerce/) come `subscription.updated`, `subscription.lapsed`, `credit.granted`, `credit.expired`, `invoice.issued` and `payout.paid`, with the same signing and delivery.

## Credit events (embedded partners)

`customer.credit_limit_reached` is sent when a customer reaches the monthly credit limit you set. `partner.balance_low` is sent when your fund falls under the low-balance threshold. Both carry credit amounts, not currency, and use the same signing and delivery.

```json
{ "type": "customer.credit_limit_reached", "externalTenantId": "clinic-1", "limitCredits": 0, "usedCredits": 0 }
```

```json
{ "type": "partner.balance_low", "balanceCredits": 0, "thresholdCredits": 0 }
```

## Alerts for your team

Whoever manages the partner is also told in the app and by email, with no webhook needed: a customer reaching the monthly limit, the credit fund running low, an automatic top-up, a new invoice, a payment past due and a connector down. Several alerts in a row arrive as one email. In **Integration** you can turn the email off for each kind; the in-app alert is always on. The webhook stays optional, for connecting your own system.
