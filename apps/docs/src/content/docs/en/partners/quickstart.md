---
title: "Quickstart"
description: "From zero to the assistant embedded in your page, in four steps."
sidebar:
  order: 2
---

You will create a partner, apply an agent template, provision a customer with `PUT /tenants` and embed the assistant with `<corvo-assistant>`.

## 1. Create the partner

The Rook team sets up your partner and hands you the **key** (`Authorization: Bearer <key>`). It is shown once; keep it on your backend, never in the browser. To replace it, use **New key** under **Settings > Partnership**: the old one stops working immediately.

## 2. Apply a template

The template defines the agents every new customer gets, the lead agent's name, the color and the connector. Under **Settings > Partnership > Import**, load the `.json`, check the agents, type the address of your MCP server and save.

```json
{
  "chiefName": "Acme Assistant",
  "accent": "#e11d48",
  "models": "fixed",
  "hide": ["store", "artifacts"],
  "connector": { "slug": "acme-system", "name": "Acme system", "endpoint": "https://mcp.acme.example/v1" },
  "agents": [
    {
      "key": "manager",
      "name": "Manager",
      "instructions": "You help the team with today's schedule and customers.",
      "usesConnector": true,
      "starters": ["Show today's bookings"]
    }
  ]
}
```

A template applies to customers made **from then on**. Agents are made once per `key` and never overwritten; what the customer edits stays.

## 3. Provision the customer

When the customer signs up in your product, call (safe to repeat):

```bash
curl -X PUT https://api.rook.team/api/partner/v1/tenants/shop-1 \
  -H "Authorization: Bearer $ROOK_PARTNER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Shop One",
    "locale": "en",
    "connectorToken": "<this customer'"'"'s token>",
    "allowanceCents": 1500,
    "period": "2026-11"
  }'
# → { "tenantId": "...", "created": true }
```

## 4. Embed the assistant

A route on your backend asks for the entry code and returns **only the code**:

```js
// POST /rook/session — requires the user to be signed in to your product
app.post("/rook/session", async (req, res) => {
  const r = await fetch("https://api.rook.team/api/partner/v1/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.ROOK_PARTNER_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ externalTenantId: req.user.tenantId, externalUserId: req.user.id }),
  });
  const { url } = await r.json();
  res.json({ code: new URL(url).searchParams.get("code") });
});
```

:::caution
Return only the one-use code to the browser. Never the partner key or the full redirect address.
:::

On the page:

```html
<script src="https://app.rook.team/sdk.js"></script>
<corvo-assistant session-url="/rook/session" theme="auto" style="height: 600px"></corvo-assistant>
```

Done: the customer sees the assistant, already signed in, with the template's agents. Attributes and events are in the [SDK](/en/partners/sdk/).
