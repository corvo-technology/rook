---
title: "Referência da API"
description: "Autenticação, clientes, pausa e retomada, e sessões."
sidebar:
  order: 3
---

Base: `https://api.rook.team/api/partner/v1`. Toda chamada envia `Authorization: Bearer <chave de parceiro>` e JSON.

**Erros.** Uma chave ausente ou errada sempre responde o mesmo `401`. Um cliente que não existe e um cliente de outro parceiro respondem ambos `404`, e um cliente pausado responde `404` nas rotas de consulta. Chaves e dados de um parceiro nunca vazam para outro.

## Criar ou atualizar um cliente

`PUT /tenants/{externalTenantId}` é idempotente: repita à vontade.

```http
PUT /api/partner/v1/tenants/loja-1
{
  "name": "Loja Um",
  "locale": "pt-BR",
  "connectorToken": "<token por cliente>",
  "allowanceCents": 1500,
  "period": "2026-11",
  "state": "enabled"
}
```

```json
{ "tenantId": "...", "created": true }
```

| Campo | Descrição |
| --- | --- |
| `name` | Nome do cliente. |
| `locale` | Idioma do cliente (`pt-BR`, `en`...). Nomeia o Chief e só importa na primeira criação. Português lê português; sem `locale` ou outro idioma, lê inglês. |
| `connector` | `{ slug, name, endpoint, token }`. Opcional se o modelo já define o conector. |
| `connectorToken` | Token do conector deste cliente, quando o modelo define o conector. Segue a última chamada. |
| `agents` | Lista `{ key, name, instructions, usesConnector, starters? }`. Opcional: normalmente vêm do modelo. O que a chamada informa vale mais que o modelo. |
| `allowanceCents` | Crédito do cliente no período. Aumentar soma a diferença; reduzir não tira nada de volta. |
| `period` | Mês, `AAAA-MM` (padrão: o atual). |
| `state` | `enabled` ou `suspended`. |

`starters` são até quatro mensagens curtas exibidas como botões enquanto o chat está vazio.

### Crédito e limites

A cota sai do saldo da conta dona do parceiro. Duas respostas pedem ação sua; em ambas o cliente e seus agentes **já foram criados** e o corpo traz `tenantId`, então você adiciona crédito ou aumenta o limite e repete a chamada:

| Status | Corpo | Significa |
| --- | --- | --- |
| `402` | `{ "error": "wallet_insufficient" }` | O saldo não cobre a cota. |
| `409` | `{ "error": "allowance_limit" }` | Passou de um limite que você definiu (por cliente ou total no mês). |

O que o cliente não usa até o fim do mês volta ao saldo do dono.

## Pausar e retomar

```http
POST /tenants/{externalTenantId}/suspend
POST /tenants/{externalTenantId}/resume
```

Ou use `state` no `PUT`. Um cliente pausado tem as execuções recusadas na hora ("This account is paused"), nenhum link abre e quem já estava logado é desconectado, inclusive iframes abertos.

## Sessões: deixar uma pessoa entrar

```http
POST /sessions
{ "externalTenantId": "loja-1", "externalUserId": "user-42", "email": "opcional@exemplo.com" }
```

```json
{ "url": "https://app.rook.team/api/partner/enter?code=...", "expiresAt": "..." }
```

Para **redirecionar**, envie o navegador à `url` em até 60 segundos; o link vale uma vez e entra como dono do cliente. Para **embutir**, devolva só o `code` da `url` à sua página ([SDK](/partners/sdk/)).

A sessão de um cliente termina oito horas depois de criada, por mais que seja renovada; a página pede um novo código ao menos nesse intervalo.

## Gravação de consultas

As rotas de [gravação de consultas](/partners/consultations/) vivem sob `/tenants/{externalTenantId}/consultations`.

## Eventos

O seu sistema avisa o que acontece (falta, atraso, consulta finalizada) em `POST /tenants/{externalTenantId}/events`; veja [Eventos](/partners/events/).

## Comércio

Catálogo, assinatura, recargas, saldo e uso: <span class="soon">em breve</span>, veja [Comércio](/partners/commerce/).
