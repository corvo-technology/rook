---
title: "Models and budgets"
description: "Automatic routing, model tiers and monthly limits."
sidebar:
  order: 1
---

## The agent's model

Each agent uses a fixed model or **Automatic**. With Automatic, Rook picks the model for each turn, starting from cheap, deterministic signals, and uses a stronger model only where it earns its cost.

## Tiers

| Tier | Used for |
| --- | --- |
| **Fast** | Small, routine turns: triage, summaries, short replies. |
| **Main** | Ordinary work and anything that continues an already approved action. |
| **Strong** | Code, large contexts and work the others failed at. |

The choice follows this order: the tier the run already settled on; code, or an engineering, research or computer agent (strong); a very large conversation (strong); continuing an approval (main, at least); an email, triage, support or summary agent with a short request (fast). If it is still ambiguous, one tiny call to the fast model names the tier; if that fails, main is used.

A run that fails on a cheaper tier because of a loop, repeated failing tool calls or unusable output moves up to the next tier **once**. It shows on the Usage page.

## Budgets

An agent can have a **monthly token limit** (UTC month). At the limit, new runs fail before calling the model, with a clear notice. Each run also has a reply cap of 10% of the monthly limit, so a single task cannot eat the month. Whoever can configure the space can also **pause every agent** at once.

The server enforces the limit and the pause; no agent can read or change those settings.
