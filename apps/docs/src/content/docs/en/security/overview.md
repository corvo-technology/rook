---
title: "Security and privacy"
description: "Data isolation, encryption, audit and LGPD notes."
sidebar:
  order: 1
---

## Data isolation

- **Per space.** Each space (and, for partners, each customer) is a separate organization. One's people, agents, conversations, memory and connections never show up in another, and the isolation is enforced on the server and in the database, not in the interface.
- **Between partners.** A partner only reaches its own customers: one partner's key never sees, or even confirms the existence of, another's customers (both cases answer `404`).
- **Between agents.** A person's private conversations with an agent stay theirs. A person's memory is theirs, per space.
- **Computers.** Each space has its own computer; agents that need their own isolation can use a private computer, and each agent's browser has a separate profile.
- **Connections.** Each agent only reaches what you allowed, at the level you set (No access, Read, Read and write). A connected database is read-only and accepts one query at a time.

## Encryption

User content is encrypted before it reaches the database or file storage: messages, conversation events, memory, wiki pages, uploaded and generated files, and credentials. A copied backup or disk does not reveal it. Connections to Rook use TLS.

## Real actions need approval

By default, anything that changes something waits for a person's yes. The [approval modes](/en/start/approvals/) and [budget](/en/agents/models/#budgets) limits are enforced by the server; no agent can change them.

## Audit

Rook records security events, without message content, secrets or tokens:

- sign-ins, sign-outs and failed attempts;
- session revocation and credential changes;
- creation, change and removal of model, connector and secret credentials;
- approval decisions and policy changes;
- refused internal or private destinations;
- each query an agent runs on a connected database (connection, agent, duration, row count, outcome, **never** the statement or the rows);
- for partners, creation, reading and deletion of consultation recordings.

Records are immutable and kept for a limited time.

## Secrets

Credentials are stored encrypted and are never returned to the model. When an agent needs a secret, it **asks** a person for it instead of reading it from somewhere.

## LGPD

:::note
This page describes technical controls and is not legal advice. The roles of controller and processor depend on your case; confirm them with your legal team.
:::

- **Minimization.** Rook sends model providers only what each turn needs. Content is not used to train models and does not go to logs.
- **Consent.** In sensitive flows, such as [consultation recording](/en/partners/consultations/), the data subject's consent is obtained **by the partner beforehand** and stored with the record. Without it, nothing is recorded.
- **Retention and deletion.** A consultation's audio and transcript are deleted on the schedule the partner chooses (1 to 365 days) or at once, on demand. Memory and the wiki can be read, corrected and deleted by the space's people.
- **Pause.** A partner can pause a customer at any time: runs stop and open sessions are ended.
- **No hidden automation of decisions.** What Rook produces from personal data arrives as a draft; the decision and the signature stay with a person.

## Report a vulnerability

Write to [security@rook.team](mailto:security@rook.team). Do not open a public ticket with the details.
