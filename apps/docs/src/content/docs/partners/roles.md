---
title: "Papéis"
description: "O que cada papel do seu sistema vê e faz no assistente."
sidebar:
  order: 10
---

Cada pessoa que você deixa entrar ([Sessões](/partners/api/#sessões-deixar-uma-pessoa-entrar)) vê e faz só o que o papel dela permite. O modelo do seu parceiro declara isso em `roles`:

```json
{
  "agents": [ { "key": "recepcao", "...": "..." }, { "key": "escriba", "...": "..." } ],
  "roles": {
    "reception": { "agents": ["recepcao"], "permissions": ["talk_to_agents"] },
    "professional": { "agents": ["escriba"], "permissions": ["talk_to_agents"] },
    "manager": { "agents": ["*"], "permissions": ["talk_to_agents", "approve_actions", "manage_routines", "view_usage"] }
  }
}
```

- `agents`: as chaves dos agentes do modelo que o papel usa; `*` é todos.
- `permissions`: direitos no cliente. Todo papel já pode `talk_to_agents`. `approve_actions` dá o direito de aprovar; `manage_routines`, de ver e criar rotinas; `manage_agents`, de ver a área de agentes.
- `hide`: áreas a esconder além das do modelo (`team`, `billing`, `settings`, `routines`, `workflows`, `usage`, `artifacts`, `store`).

## O que sempre vale

- `owner` (ou sessão sem `role`): tudo, como sempre. Entra pela conta do cliente.
- Quem não é `owner` nunca vê cobrança nem configurações, e só vê a área de agentes com `manage_agents`.
- Um papel que o modelo não define não recebe nenhum agente. Um nome errado nunca abre mais do que deveria.
- Cada pessoa tem as próprias cópias dos agentes do papel, e só ela as vê e conversa com elas.

## Padrões dos modelos

| Papel | Prontu | GreenBarber e Divellas |
| --- | --- | --- |
| `owner` | tudo | tudo |
| `manager` | todos os agentes, aprova | todos os agentes, aprova |
| `reception` | só Recepção (agenda e contato), sem conteúdo clínico | Recepção e o agente de clientes |
| `professional` | só o Assistente de prontuário | Recepção e o agente de clientes, com o seu `scope` na agenda e nos clientes |

O agente Gestor (números e financeiro) é do `owner` e do `manager`. O Greenflow já controla os profissionais do lado dele; o `scope` (por exemplo `professionalId`) chega ao seu conector em cada chamada, para você filtrar ([Conector](/partners/connector/#quem-está-pedindo)).

No console do parceiro, o detalhe de cada cliente lista as pessoas e o papel de cada uma, só para leitura.
