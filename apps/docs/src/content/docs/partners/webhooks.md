---
title: "Webhooks"
description: "Avisos de crédito e como verificar a assinatura."
sidebar:
  order: 5
---

O Rook chama uma URL sua quando um cliente usa **80%** do crédito do mês e de novo quando ele **acaba**. A URL precisa ser `https` e pública; ela e o segredo de assinatura são configurados com a equipe do Rook, que também pode trocar o segredo quando você pedir (o antigo deixa de valer).

## O aviso

`POST` com corpo JSON, enviado **uma vez por cliente, tipo e mês**:

```json
{
  "id": "evt_...",
  "type": "tenant.allowance_low",
  "createdAt": "2026-11-20T12:00:00.000Z",
  "externalTenantId": "loja-1",
  "period": "2026-11",
  "grantedCents": 1500,
  "usedCents": 1260,
  "remainingCents": 240
}
```

`type` é `tenant.allowance_low` ou `tenant.allowance_exhausted`. O corpo nunca traz chave, token ou conteúdo do cliente.

| Cabeçalho | Valor |
| --- | --- |
| `X-Rook-Event` | O `type`. |
| `X-Rook-Delivery` | O `id`, para deduplicar. |
| `X-Rook-Timestamp` | Segundos desde a época. |
| `X-Rook-Signature` | `sha256=<hex>`: HMAC-SHA256, com o segredo, de `<timestamp>.<corpo bruto>`. |

## Verificar a assinatura

Calcule o HMAC sobre o **corpo bruto** (antes de interpretar o JSON), compare em tempo constante e **rejeite timestamps com mais de alguns minutos**.

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
  // deduplique por req.get("X-Rook-Delivery")
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
    body = request.get_data()  # corpo bruto
    expected = "sha256=" + hmac.new(
        SECRET, f"{timestamp}.".encode() + body, hashlib.sha256
    ).hexdigest()

    fresh = timestamp.isdigit() and abs(time.time() - int(timestamp)) < 300
    if not fresh or not hmac.compare_digest(received, expected):
        abort(401)

    event = request.get_json()
    # deduplique por request.headers["X-Rook-Delivery"]
    print(event["type"], event["externalTenantId"])
    return "", 200
```

## Entrega e novas tentativas

Responda qualquer `2xx` quando tiver tratado o aviso. Qualquer outra resposta, ou nenhuma em dez segundos, é tentada de novo com espera crescente (até 8 tentativas), e um aviso ainda não entregue volta à fila por até três dias. Por isso o seu tratador deve ser **idempotente**: use `X-Rook-Delivery`.

## Em breve

Com a [API de comércio](/partners/commerce/) chegam `subscription.updated`, `subscription.lapsed`, `credit.granted`, `credit.expired`, `invoice.issued` e `payout.paid`, com a mesma assinatura e entrega.

## Eventos de crédito (parceiros embarcados)

`customer.credit_limit_reached` é enviado quando um cliente chega ao limite mensal de créditos que você definiu. `partner.balance_low` é enviado quando o seu fundo fica abaixo do limite de saldo baixo. Os dois trazem valores em créditos, não em moeda, e usam a mesma assinatura e entrega.

```json
{ "type": "customer.credit_limit_reached", "externalTenantId": "clinic-1", "limitCredits": 0, "usedCredits": 0 }
```

```json
{ "type": "partner.balance_low", "balanceCredits": 0, "thresholdCredits": 0 }
```
