# CLI engines

A CLI engine lets a bot think with a coding-agent CLI that is already installed on the machine that runs the engine and signed in to a plan there, so no API key is needed. Slice 1 supports Claude Code. The models are `claude/sonnet`, `claude/opus` and `claude/haiku`, offered by the operator like the local model server's: no stored credential.

The CLI owns its own model loop. Corvo owns every tool: each turn runs the CLI once, and its only tools come from a loopback MCP endpoint that Corvo opens for that turn. Every call is forwarded to the run executor's gate, so approvals, taint tracking, audit and turn guards apply unchanged.

## Availability

The feature is always on. Corvo looks for the CLI when the API and worker start; if it is installed, its models appear in the catalog, and if not, nothing shows. A bot that saved a CLI engine model on a machine without the CLI fails like any model whose connection is gone. A container started from the Compose files does not have the CLI, so it offers nothing.

The API does not start the engine when a billing provider is configured, so a hosted multi-tenant deployment never offers a machine-owned subscription to its customers. A run that carries a hosted-credit observer is refused before the CLI starts.

Whoever can pick models on the deployment may use the engine, because the person who runs the machine chose to share it.

> Note for operators: whether the CLI vendor's terms of use allow another application to run the CLI non-interactively on your own machine with your own plan is the maintainer's call; read those terms before sharing the machine with anyone but yourself.

## Where things live

- The CLI's own settings and sign-in live in `DATA_DIR/engines/claude/config`, a folder created with mode `0700` that belongs to Corvo. Sign the CLI in once inside that folder. Your own `CLAUDE.md`, skills, plugins, agents, hooks and MCP servers never load.
- Each turn runs in an empty working folder under `DATA_DIR/engines/claude/turns/`, removed when the turn ends.
- The bot's instructions go in a `0600` file passed by path. The conversation goes on stdin. Neither appears in the arguments.

## Status

`models.cliEngines` (cached for a minute) and `models.refreshCliEngines` report one status per engine:

| State | Meaning |
| --- | --- |
| `missing` | No binary was found. |
| `unsupported` | The version is below the floor, or the binary does not answer `--version`. |
| `signed_out` | Not signed in. |
| `api_key` | Signed in with an API key rather than a plan. |
| `ready` | Signed in to a plan; the models are offered. |

Only a plan sign-in runs. Connect an API key as an ordinary model connection instead, which Corvo meters itself. The status carries no path, account or email.

## Threat model

- **Loopback port.** Without the 48-hex token a request gets 404, and cannot tell a wrong token from a wrong path. A request with an `Origin` header, or with a `Host` other than the gateway's own address, gets 403, so a web page cannot use it, including by DNS rebinding. Bodies over 8 MB get 413.
- **URL secrecy.** The per-turn URL exists only in the engine's memory and in the child's environment, never in its arguments or the logs. It stops working when the turn ends.
- **Tool allow-list.** A turn's tools are fixed when its session opens. A call to any other name is refused before it reaches the executor. Allowed calls still pass the full gate; the gateway never decides permission.
- **Child environment.** The child gets `PATH`, `HOME`, `USER`, `TMPDIR`, `LANG`, `LC_ALL` and `SHELL`, plus its config folder, the gateway URL and two settings. Engine secrets and every variable that would switch the CLI to API billing or another route never reach it.
- **The CLI's own tools.** They are off by flags, then verified from the CLI's start report on every turn (every listed tool is one of this turn's, the only server is the gateway and connected, and the key source is a plan sign-in), then rechecked on every tool use it reports. A violation, or a missing start report, kills the process and fails the run before any tool of that turn runs.
- **Concurrency.** At most four turns run at once per engine process.

A CLI update that renames the start report's fields fails closed.
