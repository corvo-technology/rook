---
title: "Events"
description: "Your system tells Rook what happens, and the customer's agents act on their own."
sidebar:
  order: 10
---

A customer's agents don't have to wait to be called. When your product reports that a patient didn't show up or a payment is late, Rook starts the customer's **routines** that wait for that moment. Whatever the agent proposes to change still goes through the customer's approval, as with any routine.

[Alerts](/en/partners/webhooks/) and the webhook are unchanged: they go from Rook to you. Events go the other way.

## Send an event

```http
POST /api/partner/v1/tenants/{externalTenantId}/events
Authorization: Bearer cpk_...
Idempotency-Key: appt-9-no-show
Content-Type: application/json

{
  "type": "appointment.no_show",
  "occurredAt": "2026-12-01T10:00:00-03:00",
  "data": { "customerName": "Maria", "service": "Haircut", "appointmentId": "a-9" }
}
→ 202 { "id": "...", "matched": 1, "delivered": 1 }
```

- `Idempotency-Key` is required (up to 128 visible characters). Repeating the key with the same body answers `200` with the same response and starts nothing again; another body under the same key answers `409` with `idempotency_conflict`.
- `occurredAt` is optional and defaults to the moment of receipt.
- `matched` is how many of the customer's routines were waiting for the event; `delivered`, how many were woken.
- The key is the same as the rest of the API, and the same `404` applies to a customer that is missing or belongs to another partner.

## Catalogue

| `type` | When to send | Suggested fields in `data` |
| --- | --- | --- |
| `appointment.created` | An appointment was booked | `appointmentId`, `customerName`, `service`, `startsAt` |
| `appointment.cancelled` | An appointment was cancelled | `appointmentId`, `customerName`, `startsAt` |
| `appointment.no_show` | The customer didn't show up | `appointmentId`, `customerName`, `service`, `startsAt` |
| `payment.overdue` | A payment is past due | `customerName`, `amount`, `dueAt` |
| `consultation.finished` | A visit ended | `appointmentId`, `customerName`, `professionalName` |
| `customer.created` | A new customer was added | `customerId`, `customerName` |
| `customer.inactive` | A customer hasn't been back in a while | `customerId`, `customerName`, `lastVisitAt` |
| `custom` | Any other moment | free; needs `name` |

A `custom` event carries a `name` (letters, digits, `.`, `_` and `-`, up to 64 characters), for example `{ "type": "custom", "name": "stock.low", "data": { } }`. For the other types, `name` is refused. `data` is a JSON object; the fields above are a suggestion, not a requirement.

## What the agent sees

`data` is **data, not instructions**. Rook hands it to the agent inside a block marked as untrusted, after the words of the routine that the customer (or your template) wrote; text inside `data` is never read as an order. Still, don't put in it what an end customer typed unless you need to, and never secrets.

## Event routines

An event routine declares the type it waits for and, if you like, filters: conditions on `data`, all true at once (`{ "path": "service", "equals": "Haircut" }`; nested paths use a dot, such as `invoice.status`).

Your [template](/en/partners/central/) can ship event routines as defaults for every new customer:

```json
"routines": [{
  "key": "reschedule-no-show",
  "agent": "reception",
  "name": "Reschedule no-shows",
  "prompt": "A patient didn't show up. Write a draft message offering new times, for approval.",
  "on": { "type": "appointment.no_show" },
  "active": true
}]
```

`agent` is the `key` of an agent in the same template. The customer sees the routines in **Routines**, in plain language ("When a customer doesn't show up…"), and switches each one on or off; a routine they switched off stays off when the template is applied again.

## Limits and errors

| Response | When |
| --- | --- |
| `202` | Accepted |
| `400` | `invalid_json`, `invalid_event` or `idempotency_key_required` |
| `401` / `403` | Bad key / missing scope |
| `404` | Customer missing or another partner's |
| `409` | `tenant_suspended` or an idempotency conflict |
| `413` | Body over 16 KB |
| `429` | More than 60 events a minute for the same customer, or the partner's request limit |

Refused events (`400` and `409` for a known customer) are logged with the body received, cut short, so you can debug them. Events are kept for 30 days and can be seen in the console under **Integration → Events**, with the counts of the last 24 hours and the latest errors.
