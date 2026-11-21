---
title: "Use Rook from Claude Code, Codex and Cursor"
description: "Connect any MCP client to your account to talk to your agents."
sidebar:
  order: 5
---

Any MCP client can talk to your agents. It connects to your Rook with a key, and everything it does goes through the same checks as the app, as you.

## Make a key

Open **Settings > MCP**, give the key a name, pick what it may do and, if you have several spaces, whether it is limited to one. The key is shown once. Copy it then; Rook keeps only a fingerprint. **Revoke** ends a key at once. Each key shows when it was last used.

| Access | The client can |
| --- | --- |
| **Read** | List spaces, agents, channels and tickets, and read conversations. |
| **Talk** | Also message an agent or a channel, create tickets and comment on them. |
| **Configure** | Also create and edit agents and routines, suggest memories and add wiki pages. |

Deleting, deciding approvals, people, secrets and approval rules are never available, whatever the key.

## Connect

The address is your Rook address followed by `/mcp`. Settings shows it with a command ready to copy.

Claude Code:

```bash
claude mcp add --transport http rook https://YOUR-ROOK/mcp --header "Authorization: Bearer YOUR_KEY"
```

Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.rook]
url = "https://YOUR-ROOK/mcp"
bearer_token_env_var = "ROOK_MCP_KEY"
```

Cursor, in `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "rook": {
      "url": "https://YOUR-ROOK/mcp",
      "headers": { "Authorization": "Bearer YOUR_KEY" }
    }
  }
}
```

## What to expect

- **Messages.** A message to an agent is sent as you, and the tool waits for the reply for up to 30 seconds by default. If the agent is still working, the client gets a handle and reads the conversation later. An agent that needs approval waits for you in the app.
- **Changes are marked.** Tickets, comments and wiki pages written through a key end with "via MCP key" and its name. Agent edits show the same in the agent's instruction history.
- **Routines start off.** A routine made through a key is switched off until you turn it on.
- **Memories wait.** A fact suggested through a key waits in the app until you save it.
- **Limits.** A key may make 60 calls a minute.
