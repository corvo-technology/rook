---
title: "Quickstart"
description: "Do zero ao assistente embutido na sua página, em quatro passos."
sidebar:
  order: 2
---

Você vai criar um cliente, aplicar um modelo de agentes, provisionar o cliente com `PUT /tenants` e embutir o assistente com `<corvo-assistant>`.

## 1. Crie o parceiro

Com a equipe do Rook você recebe o parceiro e a **chave** (`Authorization: Bearer <chave>`). Ela aparece uma só vez; guarde-a no backend, nunca no navegador. Para trocá-la, use **Nova chave** em **Configurações > Parceria**: a antiga para de funcionar na hora.

## 2. Aplique um modelo

O modelo define os agentes que todo cliente novo recebe, o nome do agente principal, a cor e o conector. Em **Configurações > Parceria > Importar**, carregue o `.json`, confira os agentes, informe o endereço do seu servidor MCP e salve.

```json
{
  "chiefName": "Assistente Acme",
  "accent": "#e11d48",
  "models": "fixed",
  "hide": ["store", "artifacts"],
  "connector": { "slug": "acme-system", "name": "Sistema Acme", "endpoint": "https://mcp.acme.example/v1" },
  "agents": [
    {
      "key": "manager",
      "name": "Gerente",
      "instructions": "Você ajuda a equipe com a agenda e os clientes do dia.",
      "usesConnector": true,
      "starters": ["Mostre os agendamentos de hoje"]
    }
  ]
}
```

O modelo vale para clientes criados **a partir dali**. Os agentes são criados uma vez por `key` e nunca sobrescritos; o que o cliente edita fica.

## 3. Provisione o cliente

No cadastro do cliente no seu produto, chame (é seguro repetir):

```bash
curl -X PUT https://api.rook.team/api/partner/v1/tenants/loja-1 \
  -H "Authorization: Bearer $ROOK_PARTNER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Loja Um",
    "locale": "pt-BR",
    "connectorToken": "<token deste cliente>",
    "allowanceCents": 1500,
    "period": "2026-11"
  }'
# → { "tenantId": "...", "created": true }
```

## 4. Embuta o assistente

Uma rota no seu backend pede o código de entrada e devolve **só o código**:

```js
// POST /rook/session — exige o usuário logado no seu produto
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
Devolva ao navegador apenas o código de uso único. Nunca a chave de parceiro nem o endereço de redirecionamento completo.
:::

Na página:

```html
<script src="https://app.rook.team/sdk.js"></script>
<corvo-assistant session-url="/rook/session" theme="auto" style="height: 600px"></corvo-assistant>
```

Pronto: o cliente vê o assistente, já logado, com os agentes do modelo. Atributos e eventos em [SDK](/partners/sdk/).
