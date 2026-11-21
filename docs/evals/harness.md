# Run-level harness evals

These evals measure the agent harness, not the model: what a run sends on every call, what it costs
in tokens, how long it takes to say something, and what it leaves behind. They are the guard rail for
harness changes such as smaller tool definitions, earlier acknowledgements, result overflow and
routing. Run them before and after a change and diff the two reports.

A run is one agent turn on the real Pi runtime with the real built-in tool selection, the real
find_tool/use_tool bridge, the real tool-call loop and the real continuation rules. The model and the
world around it are fixtures.

## Run it

```bash
# Offline, deterministic, no network, no database. This is the mode CI runs.
pnpm test:evals:harness
pnpm test:evals:harness --list
pnpm test:evals:harness --case greeting --case routine-tick-silent

# Save a report, change the harness, run again and diff.
pnpm test:evals:harness --output test-report/evals/before.json
pnpm test:evals:harness --baseline test-report/evals/before.json
```

The committed `docs/evals/harness-baseline.json` is the offline report for `main`. Diff against it with
`--baseline docs/evals/harness-baseline.json`, and replace it in the same change when a harness change
moves the numbers on purpose. Only the token, call and schema columns are diffed; wall time and first
text latency are printed but are noise offline.

Offline mode needs no setup. `pnpm test:evals:harness` exits non-zero when any task fails its checks.

### Live mode

Live mode runs the same tasks against model connections you configure. It is opt-in, spends money and is
never run in CI.

```bash
pnpm test:evals:harness --live \
  --connection connection.json --pricing pricing.json \
  --spend-cap-usd 2 --output test-report/evals/live.json
```

- `--connection` is a `models/connect` JSON file. Use `--fast-connection`, `--main-connection` and
  `--strong-connection` to serve each tier from a different model; a tier without its own file falls
  back to `--connection`.
- `--pricing` is explicit USD per million tokens (`source`, `version`, `input`, `output`, `cacheRead`,
  `cacheWrite`). The run stops at `--spend-cap-usd`.
- `--judge-connection` and `--judge-pricing` turn on the prose rubric (below). Judge cost is reported
  apart from the subject cost.

Tools in live mode still answer from fixtures, so the world is deterministic and only the model varies.
A live report cannot be diffed against an offline one.

## What each task is

Each task is a scripted product moment with an outcome-state grader. A grader reads what changed in the
fixture world (tool calls made, files, memory, drafts, sends, schedules, handoffs, questions asked,
silence), never the exact wording of a reply.

| Task | Tier | Checks |
| --- | --- | --- |
| quick-question | fast | answers with no tools |
| greeting | fast | short reply, no tools |
| web-lookup | main | search then open the page, answer from it |
| multi-step-report | main | list, read twice, write a file with the right total |
| long-batch-checkpoint | main | 12 items in 3 batches, a checkpoint after each, final list saved |
| routine-tick-silent | fast | checks the source, then says nothing and changes nothing |
| routine-tick-change | fast | reports the new release once and remembers it |
| handoff-to-agent | main | find_tool then use_tool reaches the right agent |
| approval-gated-send | main | the send stops at the approval gate and does not happen |
| email-triage | main | drafts the two urgent replies, sends nothing |
| calendar-conflict | main | notices the clash and asks one question instead of booking |
| memory-recall | fast | recalls the stored fact and answers from it |
| wiki-lookup | main | search, read the page, answer from it |
| ambiguous-request | fast | one question, no action |
| needs-stronger-model | main to strong | asks for a stronger model once and finishes there |
| long-history-followup | fast | a short follow-up on a 24-message thread |
| large-tool-result | main | a 30 KB web page that the answer barely needs |
| remember-preference | fast | saves one standing preference |
| schedule-routine | main | creates one weekday 08:00 schedule |
| tool-error-recovery | main | a fetch fails once, the agent recovers within four calls |
| database-question | main | describes, then runs one read-only query |

Tasks live in `packages/testkit/src/evals/run-harness-tasks.ts`; the fixture world and the connector tool
definitions are in `run-harness-world.ts`. Bump `RUN_HARNESS_FIXTURE_VERSION` when tasks, the cache
simulation or a metric definition changes, so a diff says when it mixes task and harness changes.

### The prose rubric

Where wording matters (a greeting in the user's language, one specific question, a date from a page),
a task also carries a `prose` criterion. It is graded only when a judge is configured, by the versioned
rubric `harness-prose-v1` through the same provider-neutral judge the other suites use. A judge that
errors makes the task `unqualified`, never a pass. `PROSE_JUDGE_CALIBRATION` holds reviewed pass and
fail examples to check a judge against before trusting it; bump the rubric version when either changes.
Offline runs skip it, so CI never calls a judge.

## Reading the report

The table has one row per task and a total. The JSON has the same numbers plus each check.

| Column | Meaning |
| --- | --- |
| tier | the model tier used; `main>strong` is an escalation |
| calls / tools | model calls and tool calls in the run |
| input | uncached input tokens, summed over calls |
| cacheR / cacheW | cached-read and cache-write tokens, summed over calls |
| output | output tokens |
| schema/call | tokens of the tool definitions sent, averaged over the run's model calls |
| wall ms | time for the whole run |
| first text ms | time until the user could read something: streamed text, a question, or a posted line |

`input + cacheR + cacheW` is the whole prompt the provider processed, so a change that makes the prefix
more cacheable moves tokens from input and cacheW to cacheR rather than removing them.

### Where the offline numbers come from

- **Schema tokens** are measured on the wire: the `tools` array of each request the scripted model
  server receives is serialized and counted. In live mode the wire is not visible, so the same count is
  taken from the definitions the runtime lists after the find_tool/use_tool split.
- **Token counts** use `estimateTextTokens` from the adapters, a deterministic estimate, not a provider
  tokenizer. Compare offline runs with offline runs.
- **Cache buckets** come from a deterministic prefix-cache simulation (`prefix-cache-v1`) fed by the
  real request: tools and each message are segments; what the previous call of the same leg already sent
  in the same order is a cache read, the new segments before the last message are a cache write, and the
  last message is uncached input. It models the shape of a provider's prefix cache; it does not predict
  a provider's bill.
- **Usage** reaches the report through the product's own usage events, so accounting regressions in the
  runtime show up here.
- **Wall time and first text** are real timings of a loopback run. Use them live; offline they only show
  harness overhead.

## What the first baseline shows

The offline baseline is 21 tasks, all passing, 56 model calls and 45 tool calls. Every call carries
about 8,000 tokens of tool definitions (8,011 on a chat turn, 6,732 on a scheduled tick), which is more than the history and prompt of almost every task. A scheduled tick
with nothing new takes five model calls: the check, the empty reply, and three automated continuation
prompts the runtime sends before it accepts silence. The long thread follow-up and the large web page
show how much of a run is history and tool result rather than schema.

## Limits

- The instructions are one short fixed prompt, not the product's full system prompt, so absolute input
  is lower than in production; deltas are what to compare.
- Connector tools are a few realistic definitions, not a user's whole catalog.
- The harness drives the Pi runtime and the tool selection, not the executor, the database or the
  approval store; the approval gate is a paused tool result.
- A scripted model shows what a good model could do with the harness, not whether a real one will.
  Live mode is where model behavior is measured.
