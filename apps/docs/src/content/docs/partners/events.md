---
title: "Eventos"
description: "O seu sistema avisa o Rook do que acontece, e os agentes do cliente agem sozinhos."
sidebar:
  order: 10
---

Os agentes do cliente não precisam esperar ser chamados. Quando o seu produto avisa que um paciente faltou ou que um pagamento atrasou, o Rook inicia as **rotinas** do cliente que esperam por esse momento. O que o agente propõe alterar continua passando pela aprovação do cliente, como em qualquer rotina.

Os [alertas](/partners/webhooks/) e o webhook não mudam: eles vão do Rook para você. Eventos vão no sentido contrário.

## Enviar um evento

```http
POST /api/partner/v1/tenants/{externalTenantId}/events
Authorization: Bearer cpk_...
Idempotency-Key: appt-9-no-show
Content-Type: application/json

{
  "type": "appointment.no_show",
  "occurredAt": "2026-12-01T10:00:00-03:00",
  "data": { "customerName": "Maria", "service": "Corte", "appointmentId": "a-9" }
}
→ 202 { "id": "...", "matched": 1, "delivered": 1 }
```

- `Idempotency-Key` é obrigatório (até 128 caracteres visíveis). Repetir a chave com o mesmo corpo responde `200` com a mesma resposta e não inicia nada de novo; outro corpo sob a mesma chave responde `409` com `idempotency_conflict`.
- `occurredAt` é opcional e assume o instante do recebimento.
- `matched` é quantas rotinas do cliente esperavam o evento; `delivered`, quantas foram acordadas.
- A chave é a mesma do restante da API e o mesmo `404` vale para cliente inexistente ou de outro parceiro.

## Catálogo

| `type` | Quando enviar | Dados sugeridos em `data` |
| --- | --- | --- |
| `appointment.created` | Um agendamento foi marcado | `appointmentId`, `customerName`, `service`, `startsAt` |
| `appointment.cancelled` | Um agendamento foi cancelado | `appointmentId`, `customerName`, `startsAt` |
| `appointment.no_show` | O cliente faltou | `appointmentId`, `customerName`, `service`, `startsAt` |
| `payment.overdue` | Um pagamento passou do vencimento | `customerName`, `amount`, `dueAt` |
| `consultation.finished` | Um atendimento terminou | `appointmentId`, `customerName`, `professionalName` |
| `customer.created` | Um cliente novo foi cadastrado | `customerId`, `customerName` |
| `customer.inactive` | Um cliente está há tempo sem voltar | `customerId`, `customerName`, `lastVisitAt` |
| `custom` | Qualquer outro momento | livre; exige `name` |

Um evento `custom` leva um `name` (letras, números, `.`, `_` e `-`, até 64 caracteres), por exemplo `{ "type": "custom", "name": "stock.low", "data": { } }`. Para os outros tipos, `name` é recusado. `data` é um objeto JSON; os campos acima são uma sugestão, não uma exigência.

## O que o agente vê

`data` é **dado, não instrução**. O Rook o entrega ao agente dentro de um bloco marcado como não confiável, depois das palavras da rotina que o cliente (ou o seu modelo) escreveu; texto dentro de `data` nunca é lido como ordem. Mesmo assim, não envie nele o que um cliente final digitou sem necessidade, e nunca segredos.

## Rotinas por evento

Uma rotina por evento declara o tipo que espera e, se quiser, filtros: condições sobre `data`, todas verdadeiras ao mesmo tempo (`{ "path": "service", "equals": "Corte" }`; caminhos aninhados usam ponto, como `invoice.status`).

O seu [template](/partners/central/) pode trazer rotinas por evento como padrão para todo cliente novo:

```json
"routines": [{
  "key": "reagendar-falta",
  "agent": "recepcao",
  "name": "Reagendar quem faltou",
  "prompt": "Um paciente faltou. Escreva o rascunho de uma mensagem oferecendo novos horários, para aprovação.",
  "on": { "type": "appointment.no_show" },
  "active": true
}]
```

`agent` é a `key` de um agente do mesmo template. O cliente vê as rotinas em **Rotinas**, em linguagem comum ("Quando um cliente faltar…"), e liga ou desliga cada uma; uma rotina que ele desligou continua desligada quando o template é aplicado de novo.

## Limites e erros

| Resposta | Quando |
| --- | --- |
| `202` | Aceito |
| `400` | `invalid_json`, `invalid_event` ou `idempotency_key_required` |
| `401` / `403` | Chave inválida / sem escopo |
| `404` | Cliente inexistente ou de outro parceiro |
| `409` | `tenant_suspended` ou conflito de idempotência |
| `413` | Corpo acima de 16 KB |
| `429` | Mais de 60 eventos por minuto para o mesmo cliente, ou o limite de requisições do parceiro |

Eventos recusados (`400` e `409` com cliente conhecido) ficam registrados com o corpo recebido, cortado, para você depurar. Os eventos ficam guardados por 30 dias e podem ser vistos no console, em **Integração → Eventos**, com as contagens das últimas 24 horas e os últimos erros.
