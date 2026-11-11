# CLI engines

A CLI engine lets a bot think with a coding-agent CLI that is already installed on the machine that runs the engine and signed in to a plan there, so no API key is needed. Slice 1 supports Claude Code. The models are `claude/sonnet`, `claude/opus` and `claude/haiku`, offered by the operator like the local model server's: no stored credential.

The CLI owns its own model loop. Corvo owns every tool: each turn runs the CLI once, and its only tools come from a loopback MCP endpoint that Corvo opens for that turn. Every call is forwarded to the run executor's gate, so approvals, taint tracking, audit and turn guards apply unchanged.

## Turning it on

`CLI_ENGINES_ENABLED=true` on the API and worker turns the feature on. It is off by default. With it off, no detection runs, no catalog entry appears, and a bot that saved a CLI engine model fails like any model whose connection is gone.

The desktop app's embedded engine sets the flag. A self-hosted operator sets it on purpose, on a machine where the CLI is installed (a container started from the Compose files does not have it).

The API refuses to start when the flag is on and a billing provider is configured, so a hosted multi-tenant deployment can never offer a machine-owned subscription to its customers. A run that carries a hosted-credit observer is refused before the CLI starts.

Whoever can pick models on a deployment where the operator turned the flag on may use the engine, because the operator chose to share the machine.

> Note for operators: whether the CLI vendor's terms of use allow another application to run the CLI non-interactively on your own machine with your own plan has not been confirmed. Read those terms before turning the flag on for anyone but yourself. Releases may keep the flag off until this is settled.

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
