# Risk-based approvals: more autonomy, with control

## Intent

Agents ask too often. Today the default mode is Ask, and connector risk is decided by tool-name
regexes: only names with `get/list/search/find/read` between underscores count as reads, a declared
MCP `readOnlyHint` never relaxes that check, camelCase names are not understood, and "Always allow"
covers one exact tool for one user. People spend their time approving reads.

The new rule: reading and undoable internal changes just happen; actions with an effect outside
Rook or that cannot be undone (send, post, publish, share, pay, delete, merge, deploy, run anything)
ask, unless the person already authorized that kind of action for that agent. Every automatic
approval stays auditable, and the defences against injected instructions stay at least as strong.

## Goals

- A new level, **Only what's risky** ("Só o arriscado"), is the default for every account, space
  and agent, existing ones included.
- Reads never ask: MCP `readOnlyHint`, read verbs in any position, camelCase and snake_case names.
- Undoable internal changes never ask at the default level.
- High-risk actions ask: external effect, money, deletion, merge/deploy, open-ended execution, and
  anything an MCP server marks `destructiveHint`.
- Phase 2: "Always allow" scoped to agent × connection × tool, with a coverage line on the card, one
  place to undo, and an audit trail; "Change when to ask" from the card; approvals bound to the
  exact call.
- Phase 3: a model classifier for ambiguous names (suggestion only, cached, falls back to ask),
  outbound-URL leak checks, and a per-agent money cap on payment tools.

## Non-goals

- Approving from outside chat channels (Telegram, Slack, WhatsApp).
- Changing what webhook-triggered or other unattended runs may do.
- A general undo of side effects.

## Anti-goals

- A tool marked read-only by its server that sends, pays or deletes runs without asking.
- An instruction injected through an email or web page triggers a high-risk action because a rule
  allowed that kind of action.
- "Always allow" on merge, deploy or run-anything tools.
- People losing an explicit stricter choice they made: "Always ask" and "Never ask" keep working.

## Levels

| Level | Asks for | Notes |
| --- | --- | --- |
| Always ask | every consequential call, as today's Ask | was "Ask" |
| **Only what's risky** (default) | high-risk calls only | new |
| Auto | the reviewer model decides, falls back to ask | unchanged, needs an approval model |
| Never ask | nothing the agent may already use | unchanged; limits still hold |

Existing stored "Ask" (account, space and bot) is read as **Only what's risky**: the maintainer
decided every existing agent moves to the new default. Auto and Never ask are kept. Storage stays
backward compatible (the previous release reads the old fields).

## Risk tiers (deterministic, in `packages/core/src/action-approval.ts`)

1. **Locked high risk, in code:** names with send, reply, forward, post, publish, share, invite, pay,
   charge, purchase, buy, transfer, refund, payout, delete, remove, destroy, drop, purge, wipe,
   merge, deploy, rollback, release, execute, run, invoke, trigger, commit, plus open-ended tools
   (raw SQL writes, GraphQL mutations, raw HTTP proxies), the existing explicit-approval and
   partner-write lists, and `destructiveHint: true`. A hint can never lower these.
2. **Read:** `readOnlyHint: true` (when the name is not locked), or a read verb (get, list, search,
   find, read, fetch, query, describe, view, show, check, lookup, count, preview, download, export,
   whoami, suggest, status) as the leading or trailing word of the name split on `_`, `-`, `.` and
   camelCase. Installed OpenAPI GETs and GraphQL queries are reads.
3. **Low risk:** any other write (create, update, add, set, tag, label, move, rename, archive,
   draft, schedule). Runs free at Only what's risky, asks at Always ask.
4. **Unknown:** anything that matches nothing. Asks at Only what's risky (phase 3 adds the model
   classifier).

Built-in tools keep their own lists; undoable internal ones (memory, wiki, files, the agent's own
computer, tasks) never ask at the default level.

## Injection defences (unchanged, and they win)

- The run taint gate stays: after outside content enters a run, a call on a connector the run has
  not used yet is gated even if it is low risk.
- Webhook-triggered and other unattended runs keep today's strict rules.
- Mandatory approvals and explicit-approval tools ignore levels and rules.

## Phases

1. Levels and the default, the tier classifier, MCP hints, camelCase and verbs, settings, agent
   picker, onboarding and mobile copy. Tests rewritten to the new table.
2. Scoped "Always allow" (agent × connection × tool) with coverage line, undo page and
   "auto-approved by rule" audit; "Change when to ask" from the card; approvals bound to a hash of
   the exact call and executed once. Rules never apply to a high-risk call in a tainted run.
3. Model classifier for unknown names (opt-in, provider-neutral, cached per connection and tool,
   versioned rubric, failure asks); outbound-URL leak checks on fetch; per-agent money cap on
   payment tools.

Reading a website in Only what's risky: a fetch to a site the run was not given does not ask
while the run is clean (the owner started it and no outside content entered it), because the URL
then comes from the owner or the model. Once outside content is in the run, or the owner did not
start it, a new site is still read when the URL cannot carry data: no query or fragment, a short
path, no token-like host label or path segment, and no part seen in the run's private results.
Any other fetch to a new site asks, and is refused in a webhook run. Always ask, Auto and Never ask
keep their earlier behaviour. The card says "Open <site>?" instead of the tool name.

## Approaches considered

1. **Tiers in code plus hints (chosen).** Deterministic, testable offline, uses what MCP servers
   already declare, and keeps the taint gate.
2. **A reviewer model on every call.** Flexible, but slow, costly and non-deterministic; stays as the
   optional Auto level.
3. **Per-tool human confirmation of every connector tool before use.** Strong but adds work to every
   new connection; only the unknown tier gets a human or model decision.

## Left to the builder

Field names and the exact storage of the new level, the verb lists' final spelling, copy in every
language, and the order of tests.
