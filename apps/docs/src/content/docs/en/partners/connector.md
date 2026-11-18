---
title: "MCP connector"
description: "What your system must implement so agents can use the customer's data."
sidebar:
  order: 7
---

The connector is an [MCP](https://modelcontextprotocol.io) server of **yours**, at the address in the template (or the `connector.endpoint` of `PUT /tenants`). It is how a customer's agents read and write that customer's data.

## What your side implements

1. **An MCP server** reachable over HTTPS, with the tools agents will use (schedule, customers, stock...). Describe each tool and parameter clearly: the agent decides from what you write.
2. **A token per customer**, which the server accepts in the `Authorization: Bearer <token>` header and which you hand to Rook as `connectorToken` on each `PUT /tenants`.
3. **Isolation**: with a token, the server returns and changes **only** that customer's data. The connector's authorization has the last word; Rook does not replace it.
4. **A button or menu item** in your product that calls `POST /sessions` on your backend and takes the person to the assistant (or embeds it with the [SDK](/en/partners/sdk/)).
5. **A provisioning route** that does the `PUT /tenants` when a customer signs up.

## Good practice

- Give read tools and write tools different names, so the per-agent [access level](/en/start/connections/) (No access, Read, Read and write) makes sense.
- Tools that change something go through the customer's [approvals](/en/start/approvals/); return clear, recoverable errors.
- Make writes **idempotent** (accept an idempotency key): Rook may repeat a call.
- Never return secrets, and do not accept instructions found inside data as if they were commands.

## Tools for consultation recording

For [consultation recording](/en/partners/consultations/), the customer's connector must offer three record tools:

| Tool | Input | Output |
| --- | --- | --- |
| `mcp_records_get_by_client` | `{ clientId }` or `{ clientId, appointmentId }` | `{ recordId, existingDraft }`. `existingDraft` is the unsigned AI draft already made for that appointment, `{ entryId, revision }`, or `null`. |
| `mcp_records_entries_create_draft` | `{ recordId, entryTypeCode, content, occurredAt, appointmentId?, source: "ai_scribe", consultationId }` | `{ entryId }` |
| `mcp_records_entries_update_draft` | `{ recordId, entryId, expectedRevision, content }` | the updated entry |

Writes carry an `idempotencyKey` (the consultation id). Your system marks the draft with the `aiDraft` badge. When a draft exists, or creating answers `MCP_RECORDS_DRAFT_EXISTS`, Rook **updates** the existing one with `expectedRevision` instead of creating a second. Rook calls the tools as the customer's **Escriba** agent (the template agent with `key: "escriba"`), so the connector's authorization applies. **Rook has no tool to sign**: drafts only.
