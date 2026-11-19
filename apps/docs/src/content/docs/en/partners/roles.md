---
title: "Roles"
description: "What each role in your system sees and does in the assistant."
sidebar:
  order: 10
---

Each person you let in ([Sessions](/en/partners/api/#sessions-let-a-person-in)) sees and does only what their role allows. Your partner template declares it in `roles`:

```json
{
  "agents": [ { "key": "reception", "...": "..." }, { "key": "scribe", "...": "..." } ],
  "roles": {
    "reception": { "agents": ["reception"], "permissions": ["talk_to_agents"] },
    "professional": { "agents": ["scribe"], "permissions": ["talk_to_agents"] },
    "manager": { "agents": ["*"], "permissions": ["talk_to_agents", "approve_actions", "manage_routines", "view_usage"] }
  }
}
```

- `agents`: the keys of the template agents the role uses; `*` is all of them.
- `permissions`: rights in the customer. Every role can already `talk_to_agents`. `approve_actions` gives the right to approve; `manage_routines`, to see and create routines; `manage_agents`, to see the agents area.
- `hide`: areas to hide on top of the template's (`team`, `billing`, `settings`, `routines`, `workflows`, `usage`, `artifacts`, `store`).

## What always holds

- `owner` (or a session without `role`): everything, as always. Signs in through the customer's account.
- Anyone who is not `owner` never sees billing or settings, and sees the agents area only with `manage_agents`.
- A role the template does not define gets no agents. A mistyped name never opens more than it should.
- Each person has their own copies of the role's agents, and only they see and talk to them.

## Template defaults

| Role | Clinic template | Salon and retail templates |
| --- | --- | --- |
| `owner` | everything | everything |
| `manager` | every agent, approves | every agent, approves |
| `reception` | Reception only (agenda and contact), no clinical content | Reception and the customer follow-up agent |
| `professional` | the records assistant only | Reception and the customer follow-up agent, with their `scope` on agenda and customers |

The Manager agent (numbers and finance) belongs to `owner` and `manager`. Your product should gate professionals on its side too; the `scope` (for example `professionalId`) reaches your connector on every call so you can filter ([Connector](/en/partners/connector/#who-is-asking)).

In the partner console, each customer's detail lists its people and each one's role, read-only.
