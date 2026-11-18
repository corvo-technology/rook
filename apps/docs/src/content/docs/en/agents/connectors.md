---
title: "Connectors"
description: "MCP servers, mailboxes and read-only databases."
sidebar:
  order: 4
---

All of them show up under **Settings > Connections** and use the same [access levels](/en/start/connections/).

## MCP servers

The [Model Context Protocol](https://modelcontextprotocol.io) is the standard way to give an agent tools. Connect a server by URL and choose which agents use it. With many tools (more than 20), Rook offers an on-demand catalog: the agent searches and loads only the tool it needs, keeping the context clear.

If you run a system and want agents to use it, see the [connector requirements](/en/partners/connector/).

## Mailboxes

Connect a mailbox and give an agent the access level it needs. Sending or replying on someone's behalf changes something, so it follows [approvals](/en/start/approvals/).

## Read-only databases

Connect a PostgreSQL database (connection string or its parts; it is tested on save and the password is stored encrypted) and choose which agents may query it. The agent gets two tools:

- `describe_database`: shows tables and columns;
- `query_database`: runs **one** query at a time, `SELECT`, `WITH ... SELECT` or `EXPLAIN`.

Any query that could write, or reach what it should not, is refused before it gets to the database. Each query is logged (connection, agent, duration, row count, outcome), never the statement or the rows.

:::tip
Create a read-only database user with access to only the tables needed. Defense in depth.
:::
