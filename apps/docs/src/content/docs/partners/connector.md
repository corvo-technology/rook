---
title: "Conector MCP"
description: "O que o seu sistema precisa implementar para os agentes usarem os dados do cliente."
sidebar:
  order: 7
---

O conector é um servidor [MCP](https://modelcontextprotocol.io) **seu**, no endereço informado no modelo (ou no `connector.endpoint` do `PUT /tenants`). É por ele que os agentes de um cliente leem e escrevem nos dados dele.

## O que o seu lado implementa

1. **Um servidor MCP** acessível por HTTPS, com as ferramentas que os agentes vão usar (agenda, clientes, estoque...). Descreva cada ferramenta e cada parâmetro com clareza: o agente decide pelo que você escreve.
2. **Um token por cliente**, que o servidor aceita no cabeçalho `Authorization: Bearer <token>` e que você entrega ao Rook em `connectorToken` a cada `PUT /tenants`.
3. **Isolamento**: com um token, o servidor retorna e altera **apenas** os dados daquele cliente. A autorização do conector é a última palavra; o Rook não a substitui.
4. **Um botão ou item de menu** no seu produto que chama `POST /sessions` no backend e leva a pessoa ao assistente (ou o embute pelo [SDK](/partners/sdk/)).
5. **Uma rota de provisionamento** que faz o `PUT /tenants` quando um cliente se cadastra.

## Quem está pedindo

Quando uma pessoa com `role` (veja [Papéis](/partners/roles/)) conversa com um agente, cada chamada ao seu servidor MCP leva, além do `Authorization`:

| Cabeçalho | Valor |
| --- | --- |
| `X-Rook-User` | o `externalUserId` da sessão |
| `X-Rook-Role` | o papel, como você o enviou (em minúsculas) |
| `X-Rook-Scope` | o `scope` da sessão, em JSON (omitido se não houve) |

Use-os para filtrar: um profissional vê só a própria agenda e os próprios clientes. O dono do cliente chega só com `X-Rook-Role: owner`, sem usuário nem escopo, porque todos os donos de um cliente entram pela mesma conta. O Rook reabre a conexão quando o papel ou o escopo de uma pessoa muda, então a mudança vale na próxima mensagem. **Confie nesses cabeçalhos apenas junto do token do cliente**: é o token que prova que a chamada vem do Rook.

## Boas práticas

- Dê às ferramentas de leitura e de escrita nomes diferentes, para que o [nível de acesso](/start/connections/) por agente (Sem acesso, Leitura, Leitura e escrita) faça sentido.
- Ferramentas que mudam algo passam pelas [aprovações](/start/approvals/) do cliente; devolva erros claros e recuperáveis.
- Torne as escritas **idempotentes** (aceite uma chave de idempotência): o Rook pode repetir uma chamada.
- Nunca devolva segredos, e não aceite instruções vindas de dados como se fossem ordens.

## Ferramentas para a gravação de consultas

Para a [gravação de consultas](/partners/consultations/), o conector do cliente precisa oferecer três ferramentas de prontuário:

| Ferramenta | Entrada | Saída |
| --- | --- | --- |
| `mcp_records_get_by_client` | `{ clientId }` ou `{ clientId, appointmentId }` | `{ recordId, existingDraft }`. `existingDraft` é o rascunho de IA ainda não assinado daquele atendimento, `{ entryId, revision }`, ou `null`. |
| `mcp_records_entries_create_draft` | `{ recordId, entryTypeCode, content, occurredAt, appointmentId?, source: "ai_scribe", consultationId }` | `{ entryId }` |
| `mcp_records_entries_update_draft` | `{ recordId, entryId, expectedRevision, content }` | a entrada atualizada |

As escritas trazem uma `idempotencyKey` (o id da consulta). O seu sistema marca o rascunho com o selo `aiDraft`. Se já existe um rascunho, ou se criar responde `MCP_RECORDS_DRAFT_EXISTS`, o Rook **atualiza** o existente com `expectedRevision` em vez de criar um segundo. O Rook chama as ferramentas como o agente **Escriba** do cliente (o agente do modelo com `key: "escriba"`), então a autorização do conector vale. **O Rook não tem ferramenta para assinar**: só rascunhos.

Para executar as [ações combinadas numa consulta](/partners/consultations/#a%C3%A7%C3%B5es-combinadas), o conector pode oferecer também ferramentas de disponibilidade, conflitos, criação do agendamento e rascunho de receitas, pedidos de exame, atestados e mensagens ao paciente. Todas são opcionais: uma ação cujo tipo não tem ferramenta é ignorada, e um retorno sem ferramentas de disponibilidade apenas não é verificado.
