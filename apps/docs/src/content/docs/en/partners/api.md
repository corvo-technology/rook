---
title: "API reference"
description: "Authentication, customers, suspend and resume, and sessions."
sidebar:
  order: 3
---

Base: `https://api.rook.team/api/partner/v1`. Every call sends `Authorization: Bearer <partner key>` and JSON.

**Errors.** A missing or wrong key always answers the same `401`. A customer that does not exist and a customer that belongs to another partner both answer `404`, and a paused customer answers `404` on the consultation routes. One partner's keys and data never leak to another.

## Create or update a customer

`PUT /tenants/{externalTenantId}` is idempotent: repeat it freely.

```http
PUT /api/partner/v1/tenants/shop-1
{
  "name": "Shop One",
  "locale": "en",
  "connectorToken": "<per-customer token>",
  "allowanceCents": 1500,
  "period": "2026-11",
  "state": "enabled"
}
```

```json
{ "tenantId": "...", "created": true }
```

| Field | Description |
| --- | --- |
| `name` | The customer's name. |
| `locale` | The customer's language (`pt-BR`, `en`...). Names the lead agent and only matters when the customer is first made. Portuguese reads Portuguese; no `locale` or any other language reads English. |
| `timezone` | The customer's IANA timezone (`America/Sao_Paulo`). The template's [scheduled routines](/en/partners/events/) run in it; only matters when the customer is first made. |
| `connector` | `{ slug, name, endpoint, token }`. Optional when the template already defines the connector. |
| `connectorToken` | This customer's connector token, when the template defines the connector. Follows the latest call. |
| `agents` | List of `{ key, name, instructions, usesConnector, starters? }`. Optional: usually they come from the template. What the call names wins over the template. |
| `allowanceCents` | The customer's credit for the period. Raising it adds the difference; lowering it takes nothing back. |
| `period` | Month, `YYYY-MM` (default: the current one). |
| `state` | `enabled` or `suspended`. |

`starters` are up to four short messages shown as buttons while the chat is empty.

### Credit and limits

The allowance is paid from the balance of the account that owns the partner. Two answers need action from you; in both the customer and its agents **are already set up** and the body carries `tenantId`, so you add credit or raise the limit and repeat the call:

| Status | Body | Meaning |
| --- | --- | --- |
| `402` | `{ "error": "wallet_insufficient" }` | The balance cannot cover the allowance. |
| `409` | `{ "error": "allowance_limit" }` | Over a limit you set (per customer or in total per month). |

What a customer leaves unused when the month ends goes back to the owner's balance.

## Suspend and resume

```http
POST /tenants/{externalTenantId}/suspend
POST /tenants/{externalTenantId}/resume
```

Or use `state` on the `PUT`. A paused customer's runs are refused at once ("This account is paused"), no link opens and signed-in people are signed out, including open iframes.

## Sessions: let a person in

```http
POST /sessions
{
  "externalTenantId": "shop-1",
  "externalUserId": "user-42",
  "email": "optional@example.com",
  "role": "professional",
  "scope": { "professionalId": "p-7", "branchIds": ["b-1"] }
}
```

```json
{ "url": "https://app.rook.team/api/partner/enter?code=...", "expiresAt": "..." }
```

To **redirect**, send the browser to the `url` within 60 seconds; the link works once and signs in as the person the `role` describes (without a `role`, as the customer's owner). To **embed**, return only the `code` from the `url` to your page ([SDK](/en/partners/sdk/)).

A customer's session ends eight hours after it began, however it is renewed; the page asks for a new code at least that often.

### Role and scope

Each person sees and does only what their role in your system allows. Both fields are optional; a session without them still signs in as the customer's owner.

- `role`: `owner`, `manager`, `reception`, `professional` or a name of your own (lower case, up to 32 characters: letters, digits, `_` and `-`).
- `scope`: up to 10 fields, each a string or a list of up to 50 strings (for example `professionalId` and `branchIds`). Rook does not interpret the scope: it passes it to your [connector](/en/partners/connector/#who-is-asking).

The role and scope apply again on **every session**: if a person changes role in your system, the change holds the next time they open the assistant.

Every role other than `owner` signs in as a user of their own in the customer, with their own conversations: nobody sees another person's conversations. `owner` signs in through the customer's account. What each role gets (agents, rights and what stays hidden) comes from the template's `roles`; see [Roles](/en/partners/roles/).

## Consultation recording

The [consultation recording](/en/partners/consultations/) routes live under `/tenants/{externalTenantId}/consultations`.

## Events

Your system reports what happens (no-show, late payment, finished visit) with `POST /tenants/{externalTenantId}/events`; see [Events](/en/partners/events/).

## Commerce

Catalog, subscription, top-ups, balance and usage: <span class="soon">coming soon</span>, see [Commerce](/en/partners/commerce/).
