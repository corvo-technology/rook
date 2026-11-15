# Automatic model routing

An agent can pick its model for each turn instead of keeping one. The choice is made from cheap,
deterministic signals first, so most turns spend nothing extra, and a stronger model is used only
where it earns its cost.

## Tiers

A tier is a model role, so members and spaces override a tier in **Settings → Models** the way
they override any role.

| Tier   | Role     | Used for                                             |
| ------ | -------- | ---------------------------------------------------- |
| Fast   | `fast`   | Routine, small turns: triage, summaries, short replies |
| Main   | `main`   | Ordinary work, and anything that continues an approved action |
| Strong | `strong` | Code, large contexts, work the others failed at     |

A tier with no model of its own is served by the main model, so an agent never fails for lack of
one.

## Choosing a tier

For each turn the router looks at, in order:

1. The tier the run already settled on: a retried attempt keeps it, and a run that moved up a tier
   starts there.
2. Code in the request, or an agent made for engineering, research or computer work: strong.
3. A very large conversation: strong.
4. A turn that continues an action waiting for approval: main at least.
5. An agent made for email, triage, support or summaries, with a short request and no
   attachments: fast.
6. Anything else is ambiguous. One tiny call on the fast model, with no tools and a few output
   tokens, names a tier. If it fails or answers anything but one tier, the turn runs on main.

A run that fails on a cheaper tier because of a loop, repeated failing tool calls or unusable
output is retried once on the next tier. The escalation is recorded on the run and counted on the
Usage page; it never repeats.

An automatic agent below the strongest tier can also ask for a stronger model itself, once, with
the `request_stronger_model` tool. The tool is offered only when the run is automatic, has a higher
tier with a model of its own, and has not moved up yet; it is never offered to an agent pinned to a
model, or from the strongest tier. Its description tells the agent to use it only for genuinely
hard reasoning, code or planning, never as a reflex. Calling it ends the turn: what the agent
already said stays in the chat, the run is requeued on the next tier through the same one-time
fence as a failure, and the stronger model continues from the conversation. The short reason is
kept on the run, shown as a quiet "Switched to a stronger model" line in the chat (the reason is
its tooltip), and the Usage page counts how many escalations were asked for. The run still meets
the pause state, the daily and member limits and the price ceiling when it starts again; only the
monthly agent budget gate, which it already passed, is skipped.

An agent pinned to a model keeps that model exactly. Choosing a model in the agent's settings
turns Automatic off; choosing Automatic clears the model.

## Configuring a deployment

Set the tiers beside the default model, on the same provider and key:

```
PI_DEFAULT_MODEL=<standard model>
PI_FAST_MODEL=<cheap model>
PI_STRONG_MODEL=<strong model>
```

The owner can also save the two tiers in `deployment_settings` (`fastModelId`, `strongModelId`);
a saved value wins over the environment, as the saved default model does.

New agents start on Automatic when either tier is set. Existing agents keep their model; opt one
in from its settings by choosing **Automatic** in the model list, which appears once a tier
exists.

For a hosted cloud on one OpenRouter key, a Gemini Flash or DeepSeek class model is a good fast
tier and a Claude Sonnet class model a good strong tier, with the default model between them.

## Jev Router and other variable-priced models

Any tier, or the agent's model itself, can be a router such as `typesafe/jev-router`, which picks
the model and reasoning effort for each request. Its price is not fixed: OpenRouter lists it as
`-1`. A funded call is never held at that price. The hold is the highest price of any candidate
tier model, applied to the size of the request, or `PI_MODEL_CALL_CEILING_USD` for one call when
no tier model has a known price. With neither, the call is refused for lack of a reliable price
rather than guessed. Settlement always uses the cost the provider reports for the call, and the
usage record keeps the model the router actually used.

## Judging quality

`pnpm test:evals --suite model-routing --live` compares Automatic with a fixed strong model on a
small fixed task set, and includes cases where asking for a stronger model is, or is not, the right
call (the model may start its reply with a marker instead of answering; the judge decides whether
that choice was right, by the rubric's reviewed reference). Automatic picks each task's tier with the router above and answers on that
tier's model (`--fast-connection`, `--main-connection`; the strong tier is `--connection`, which
is also the fixed model it is compared with). A judge connection (`--judge-connection`) decides by
a versioned rubric whether Automatic's answer is at least as good. Automatic's, the fixed
model's and the judge's costs are reported apart, and a judge error leaves a task unqualified
rather than passed. It is opt-in, calls real models, and is not part of CI.
