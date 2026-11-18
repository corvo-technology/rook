---
title: "Skills"
description: "Teach a procedure once and the agent repeats it."
sidebar:
  order: 3
---

A **skill** is a procedure the agent learns: "how we close the till", "how we answer a refund request". Instead of repeating the explanation in every conversation, you write it once (or show the agent and it records it) and it applies from then on.

- Write the skill as a short step-by-step with the expected outcome.
- A skill says **how**; what the agent **may** do still depends on its [connections](/en/start/connections/) and [approvals](/en/start/approvals/).
- What the whole team needs to know, rather than a procedure, goes in the **wiki**; what concerns one person goes in their **memory**.

## Memory and wiki

| | Memory | Wiki |
| --- | --- | --- |
| **Whose** | Yours, per space | The team's |
| **What** | Short facts and preferences ("answers in Portuguese") | Pages linked with `[[Title]]` |
| **How it gets in** | You write it, the agent proposes (you save) or a model suggests | A cheap model reads settled conversations and proposes; you approve, refuse or undo |

Everything is versioned and encrypted at rest.
