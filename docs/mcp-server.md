# MCP server

Rook is an MCP server, so Claude Code, Codex, Cursor or any MCP client can talk to a person's
agents. The user-facing page is "Use Rook from Claude Code, Codex and Cursor" in `apps/docs`; this
one is for people changing the code.

## Endpoint and keys

- `POST /mcp` on the API, Streamable HTTP, JSON responses, no session. Every request builds its own
  server holding only the tools the key's level unlocks, so there is nothing to hijack between
  requests. `GET` and `DELETE` answer 405. The web host proxies `/mcp` next to `/api` and `/rpc`.
- A personal access key (`rk_…`, 256 bits of randomness) is made in Settings > MCP by a signed-in
  person through `mcpAccess.create`. The whole key is returned once; only its SHA-256 digest and its
  first characters are stored (`mcp_access_keys`). A random 256-bit secret needs no slow hash.
- A key acts as the person who made it, at one level (`read`, `talk` or `configure`, each including
  the one before) and optionally in one space. `last used` moves at most once a minute. Revoking is
  immediate; deleting the person or the space deletes the key.
- `mcp_access_keys` has row-level security on the owner (`app.user_id`), so a person's list and
  revoke never see another's. The endpoint finds a key by digest before it knows whose it is, which
  is the named system read `mcp key lookup`.

## One surface

`MCP_TOOL_LEVELS` in `packages/contracts/src/mcp-access.ts` lists every tool and its level; the
implementation table in `apps/api/src/mcp-server/tools.ts` must match it exactly. The tools call
the app's own router through `createRouterClient` as the key's owner, so they meet the same
authorization, validation and row-level security as the app. `McpAppClient` names the only
procedures they may call: nothing that deletes, decides an approval, manages people or secrets, or
loosens a rule is on it, and no tool exists for those. `update_agent` takes a name, a role and
instructions only, so it cannot change an approval mode or a spending cap.

## Attribution and audit

- Tickets, comments and wiki pages written through a key end with "via MCP key <name>". An agent
  edit records `Changed via MCP key "<name>"` as the reason of its instruction version.
- A routine made through a key starts switched off and a key cannot switch one on.
- `remember` proposes a fact about the person in the state `pending`, which the person saves or
  discards in the app like any suggested fact. `write_wiki_page` adds a new page only (expected
  revision 0) and never replaces one, because the wiki's curator flow needs a conversation as its
  source.
- Every tool call writes a `mcp.tool_call` security event with the key id, level, tool, a target id
  and the outcome, never a message, title or body. Creating and revoking a key write
  `mcp.key.created` and `mcp.key.revoked`.
- Each key may make 60 calls a minute (`apps/api/src/mcp-server/rate-limit.ts`), counted per API
  process; the 429 carries `Retry-After`.

## Not built yet

OAuth 2.1 with PKCE and dynamic client registration, which a custom connector in claude.ai needs.
Keys cover clients that take a bearer header. The route is stateless, so the OAuth endpoints and a
`WWW-Authenticate` challenge can be added without changing the tools.
