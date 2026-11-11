# Run dispatch and response timing

The API commits messages and runs to Postgres. `RunJobPublisher` records an optional
wake time on the run and publishes a notification through the existing realtime
connection. It does not enqueue agent execution in Graphile.

Worker processes subscribe to notifications and scan runnable rows at startup and
every five seconds. Notifications are hints: a commit without a notification, a
listener reconnect, or an expired execution lease is recovered by the scan. Workers
claim runs using the executor's existing atomic lease and fence checks. Several
claims can start concurrently; model streams and tools run independently after
durable ownership and heartbeats are established. Memory admission and graceful
shutdown are shared with legacy queue deliveries.

Runs waiting behind another run's live computer lease stay queued without repeated
claims. The recovery scan picks them up after release or expiry, while unrelated
bots can run. Execution timing starts after computer ownership is acquired.

Graphile remains responsible for scheduled and maintenance jobs. Those jobs can
create runs, which use the same direct dispatch path. Legacy run deliveries remain
supported during rolling upgrades and drain safely against the same database
claims. Pending legacy retry times are carried into the new run schedule by the
additive migration. A compatibility trigger also stamps retry backoff when an
older worker requeues after the migration; explicit new-worker schedules take
precedence. Remove that trigger only after those older releases have drained.
Embedded installations using the memory job driver retain their
existing dispatch and recovery behavior.

## Prompt layout

The system prompt holds only what the bot's setup decides (identity and instructions, enabled
tools, workspace and reply guidance), so it does not change between turns. Memory, notes, team,
connections and skills travel as one live context block in the transcript, right before the user
message of the turn that first sent it; later turns replay it there and add a new block only when
its text changed. Everything that belongs to one run alone (current time, reply target, approvals,
recalled memory, ticket matches, routing hints) follows the user message as a turn note and is
never replayed. The runtime keeps an in-memory record per thread of what the last turn showed and
starts fresh when a message was edited, removed or inserted, the setup changed, the last turn did
not end well, or the connection's cache window has elapsed.

## Timing

Structured logs emit `run.execution_started`, `run.first_response`, and
`run.finished`. Timing fields contain durations in milliseconds:

| Field | Meaning |
| --- | --- |
| `run.pre_run_wait_ms` | Source message to run creation, including steering held behind earlier work. |
| `run.queue_wait_ms` | Run creation to its first execution start. |
| `run.first_response_ms` | Source message to first persisted visible reply text or reply card. |
| `run.total_ms` | Source message to run completion or failure. |
| `run.execution_wall_ms` | First execution start to completion, including retries and human waits. |

These are run-level measurements. Multiple steering messages can share one run;
its selected source message defines the timing origin. When a run has no source
message, its creation time is the origin. Missing start,
response, or completion timestamps omit the corresponding duration rather than
reporting zero. Use `run.trigger` and `run.outcome` to distinguish interactive,
scheduled, successful, and failed work. Use each run's first-response record for
response latency distributions and its terminal record for total duration; do not
mix timing fields repeated on different lifecycle events as independent samples.

The first response timestamp is persisted in the same transaction as its output
and is preserved across attempts, restarts, and resumes. Streamed text, final-only
replies, message tools, and reply cards count. Reasoning, working placeholders,
activity-only progress, and hidden metadata do not. Timing adds no message content
or new personal identifiers to logs. A timing-log read failure cannot fail an
already committed operation.

These are server-side availability measurements. They do not measure network
delivery or rendering on a user's device. Client delivery/render timing would need
a separate acknowledgement.

Recurring timer routines mark their origin durably and keep one pristine pending
catch-up run for the same routine, prompt, thread, and model selection. A later
tick reuses that pending work and advances the next scheduled tick, preserving
any computer retry delay. Already started runs, manual tests, explicit retries,
one-shot schedules, and change/event-triggered runs remain separate. Unmarked
older firings are preserved: a scheduled firing event alone cannot distinguish
recurring work from a one-shot whose routine was later edited.
A bounded pass cancels redundant marked timer rows with no attempts, effects,
output, steering, checkpoint, or live computer ownership, preserving historical
rows and terminal events. The `routine.coalesced` log records reuse without
another `routine.fired` event.
A timer run whose first start is more than 15 minutes after the most recent occurrence
due by then (counted from the occurrence in its marker) tells the agent both
times in the routine's timezone, so a catch-up after downtime can adapt instead
of assuming it is still the scheduled time. Late runs are never skipped.
Committed timer runs and their advanced schedules remain intact when publication
fails. Recovery repairs delivery for every driver; a notification failure never
rolls back work that another tick or dispatcher can already own.

Interactive work is scanned before scheduled/reaction work in each bounded pass.
When memory admission declines a run, dispatch leaves it durable and continues
scanning instead of waiting in a dispatch slot. Memory admission independently
checks available physical memory and unused JavaScript heap space against the
same small attachment startup buffer. External buffers are not counted against
the JavaScript heap limit, and live-run counts do not set a concurrency limit.
Notifications and periodic recovery reopen completed lanes without restarting
active pagination. Active model streams have no new duration limit.

`run.admission_wait` and `run.admission_resumed` identify a capacity episode and
its duration without logging every retry. Independently, `run.queue_delayed`
warns every thirty seconds when interactive runs have been due and queued for
at least thirty seconds, measured from the later of creation and wake time.
Normal retry backoff does not count toward this wait. It includes `queue.delayed_runs` and
`queue.oldest_wait_ms`; `run.queue_recovered` marks recovery. Future retries and
scheduled work do not trigger this warning. These checks do not block dispatch.

For optional Axiom monitoring, alert when the following query returns any events
in the last two minutes (use the deployment's configured dataset):

```apl
['YOUR_DATASET']
| where message == "run.queue_delayed"
| summarize warnings = count()
| where warnings > 0
```

The application emits the signal; notification routing belongs in the deployment's
monitor configuration. No hosted monitoring service is required for dispatch.

## Turn guards

A run that is going nowhere is stopped and ends `failed` with one sentence. The
guards read only what the run did (tool names, arguments, result hashes, failure
flags, shell command syntax and timestamps), never what the model wrote. Their
thresholds are the constants in `TURN_GUARD_LIMITS`; `ExecutorDeps.turnGuardLimits`
overrides them for the composition root and tests only.

| Guard | Stops the run when |
| --- | --- |
| Loop | The same tool with the same canonicalized arguments returns the same result 5 times in a row for that call (a note on the 3rd tells the agent to change approach). Another result for that call restarts the count; other calls in between do not reset it. |
| Errors | 8 tool calls fail in a row, whatever they are. A failure is a thrown error, an `error` field or `isError: true`; a shell command that exits non-zero is a result. One success resets the count. |
| Stall | 20 minutes pass with no sign of life while no tool is in flight. |
| Waiting | A `shell` command that only sleeps 20 seconds or more (followed at most by `echo`, `printf`, `true`, `:` or `date`) was already run once; each later one is refused, and the 4th refusal stops the run. A sleep followed by a real check, or inside a loop, always runs. |
| Per-tool counter | A read-only connector tool is called past 60 times in a run: further calls are refused (a note on the 15th asks for narrower requests) and the 4th refusal stops the run as a loop. Built-in tools and tools not declared read-only are never counted. |

Signs of life are any runtime event (text, progress, tool start, sub-agent
progress, usage) and any tool call starting or finishing. A tool in flight, a
shell command still running in the background and an approval being reviewed all
count as in flight. A gap between two watch ticks longer than four ticks plus 30
seconds means the machine was suspended: the silence clock restarts and the gap
never counts. The stall guard measures silence, not duration, so the sentence
"Active model streams have no new duration limit" still holds.

Guard state lives in memory for one attempt and is shared with sub-agents, whose
tool calls go through the same boundary. A run that paused for a person or that
another worker recovers starts its counters at zero. A stop ends the run through
the normal failure path with one of four fixed sentences, matched by exact
equality, that map to the run error kinds `loop`, `tool_errors`, `stall` and
`waiting`, and are also saved in the nullable `runs.stopReason` column. Text the
person already saw stream stays above the sentence. A stopped routine run is not
retried automatically (only transient model errors are), its failure
notification carries the sentence and its schedule keeps its next tick. The stop
is logged as `run.guard_stopped` with a `guard.kind` field and no tool arguments
or results.

## Connector waits

When a connector tool answers "still being made" (a queued or running SQL statement, a started
job), the backend asks that connector's own status tool with backoff and hands the finished result
back inside the one call the agent made. The agent spends no model step or sleep on checking.

- **Which results count.** Only structured ones: the MCP `structuredContent` object, MCP text that
  is as a whole a JSON object, or a plain-object result from an installed API or GraphQL
  connector. The reader walks nested objects (never arrays) to depth 6 and takes the first
  recognised state field with a string value. It is pending when that value is a recognised
  not-done state and an id field sits in the same object. Prose, malformed JSON, `isError`
  results, an `error` member and arrays never count. The fields, states and id rules are one
  versioned constant, `CONNECTOR_STATUS_TABLE`; natural language is never classified.
- **Which calls wait.** The called tool is offered to the bot, declares `readOnly`, and has a
  route with a `resourceId` that is not the lazy catalog route. Every id used for the status call
  must be new: it must not appear in the called tool's arguments, so reading an existing record
  whose own status says "pending" never waits. Only the starting call waits. Routes without a
  `resourceId` (Composio, Pipedream, catalog calls) pass through unchanged.
- **Which status tool.** Only a tool on the same connector resource that declares `readOnly`, is
  not named as a write, is not disabled for the bot, and whose required inputs are all ids of the
  pending result. The most required keys win; a tie means no wait. Tools are never guessed by name.
- **When the backend may call it.** Only where the agent's own call would run without asking: no
  rule resolves to ask or deny, an `always_allow` rule matches or the name reads as a read, a
  webhook run does not need approval for it, and the taint gate passes. Otherwise the first result
  is returned as it is.
- **Limits.** `CONNECTOR_WAIT_LIMITS`: the first pause is 2 s, doubling up to 15 s, for at most 5
  minutes. The loop stops at once on cancel, shutdown or a lost run lease.
- **Endings.** Done (done, failed, cancelled or an error result) returns the poll result. Time
  returns the last pending result with a model-facing note that says how long the backend waited
  and tells the agent not to sleep. A status error returns the last pending result with a note.
  A poll that is not a status for the same ids returns the first result unchanged. Stopped
  returns the last result. The stored effect result is the final one, so a replay returns what the
  agent saw.
- **Progress.** One live activity line, `Waiting for <tool>`, when the first pause starts. Routine
  and background runs publish none, as with other activity lines. The log line
  `connector.wait_finished` records the tool names, `wait.polls`, `wait.ms` and `wait.outcome`,
  never arguments or results.

When no status tool qualifies, the agent keeps waiting by hand, and the idle-sleep refusal of the
turn guards applies.
