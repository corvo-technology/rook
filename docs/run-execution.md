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

## Budgets and pause

A bot may have a monthly token limit, and a space owner may pause every bot in the
space. Both are enforced only in the run executor and the API; a client never decides
whether a run may start, and no agent tool can read or change either setting.

**What counts.** Tokens come from the `usage_records` rows, counted per row as the usage
page counts them: `totalTokens`, else `inputTokens + outputTokens`, else 0. Cached reads
are included, no money conversion is made, and a call that reports no token counts (some
subscription and OAuth connections) counts as 0. A bot on such a connection is never
blocked by a limit it cannot be measured against; it stays bounded by the tool loop
guards and the provider's own quota windows. The month is the UTC calendar month. A
limit that is empty, `0`, negative or not a finite number means no limit.

**Monthly gate.** A run of a bot whose month is at or over its limit fails before the
model with `stopReason = "monthly_limit"`. A run already going finishes under its reply
cap. The check happens when a run starts, so runs that start together may overshoot the
month by at most the sum of their reply caps.

**Reply cap.** One run (all its attempts, its subagents) may spend 10% of the monthly
limit; with no limit the 10% is taken over a fixed 50,000,000 tokens. Past the cap every
tool call is refused with a result telling the model to stop and write up what it did,
found and has left. On the fourth refused call, or once the run passes 1.3 times the
cap, it ends `failed` with `stopReason = "reply_cap"`; the text already streamed stays in
the chat. A reply that wraps up on its own after the refusal completes normally. A later
attempt of a run starts from what the earlier ones spent. History compaction calls are
recorded without the run and count toward the month, not the reply.

**80% warning.** When an attempt carries a bot's month across 80% of its limit (and not
past 100%), the owner gets one push and one line in the chat, once per bot per month,
claimed with a conditional write so two runs crossing together warn once.

**Pause.** `spaces.pausedAt` is one nullable timestamp. Pausing cancels every active run
in the space through the same path as Stop, and until resumed any run created by any
trigger fails before the model with `stopReason = "paused"` and no failure push.
Resuming restarts nothing. A routine refused by a limit or by pause fails in its history
and backs off like any refused account.

**Stop reasons.** `runs.stopReason` holds `reply_cap`, `monthly_limit` or `paused`, and
is null for every other run.
