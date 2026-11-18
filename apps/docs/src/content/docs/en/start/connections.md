---
title: "Connections"
description: "Connect apps, MCP servers, databases and mailboxes, with an access level per agent."
sidebar:
  order: 4
---

**Settings > Connections** gathers everything an agent can reach: catalog apps, MCP servers (by URL), databases and mailboxes. Each connection is a row with its state and who uses it. **Connect** opens the sheet to add one.

## Access levels

For each agent and each connection you set:

| Level | The agent can |
| --- | --- |
| **No access** | Nothing. The connection does not even show in its tool list. |
| **Read** | Look things up: list, search, read. |
| **Read and write** | Also create and change. |

The server enforces the level when tools are listed and when each one is called; it does not depend on what the agent "decides". Per-tool lists from older versions show as **Custom**.

:::note
Even with write access, actions that change something still go through [approvals](/en/start/approvals/).
:::

More on [MCP servers, mailboxes and databases](/en/agents/connectors/).
