---
title: "Gravação de consultas"
description: "Do áudio de um atendimento a um rascunho no prontuário, sem assinar."
sidebar:
  order: 8
---

Um parceiro cujos clientes mantêm prontuários (uma clínica, um salão) pode enviar ao Rook o áudio de um atendimento e receber um **rascunho** de anotação no prontuário do cliente. **O Rook nunca assina**: o profissional revisa, edita e assina no seu produto.

As rotas são do escopo de um cliente e usam a mesma chave de parceiro, o mesmo `401` para chave errada e o mesmo `404` para cliente ou consulta inexistente ou de outro parceiro. O seu [conector](/partners/connector/) precisa das ferramentas de prontuário.

## O fluxo

1. O seu produto cria a consulta, com o consentimento.
2. Envia o áudio em pedaços, a cada cerca de 10 segundos.
3. Chama `finish`. O Rook transcreve, identifica quem fala e preenche o modelo de nota.
4. O Rook cria ou atualiza o rascunho pelo seu conector.
5. O seu produto consulta o estado até `drafted` e mostra a nota ao profissional, que revisa e assina.

```http
POST /tenants/{externalTenantId}/consultations
{
  "externalUserId": "doctor-1",
  "template": "prontu_evolution",
  "context": { "clientId": "c-123", "appointmentId": "a-9",
               "professionalName": "Dra. Lima", "clientName": "Maria" },
  "consent": { "obtained": true, "at": "2026-12-01T10:00:00Z", "method": "verbal" },
  "retentionDays": 30
}
→ { "consultationId": "..." }

PUT    .../consultations/{id}/chunks/{seq}   áudio bruto, Content-Type: audio/webm ou audio/ogg
→ { "ok": true }
POST   .../consultations/{id}/finish
→ { "state": "processing" }
POST   .../consultations/{id}/reprocess      refaz uma consulta que falhou, dos pedaços guardados
GET    .../consultations/{id}
→ { "state": "drafted", "transcript": [{ "speaker": "professional", "startMs": 0, "text": "..." }],
    "note": { }, "draftEntryId": "..." }
DELETE .../consultations/{id}                apaga o áudio e a transcrição agora
```

## Consentimento

O consentimento do paciente é **seu** de obter, antes de criar a consulta, e é guardado com ela. `consent.obtained` precisa ser `true`; `method` é `verbal` ou `written`; `text` é opcional. Sem consentimento a criação é recusada.

Se você usa o painel do launcher, a faixa **Gravar consulta** faz essa pergunta ao profissional (verbalmente ou por escrito) antes de gravar; veja [Gravar consulta no painel](/partners/sdk/#gravar-consulta-no-painel).

## Modelos de nota

| `template` | Entrada no prontuário | Campos |
| --- | --- | --- |
| `prontu_evolution` | tipo `evolution` | `schemaVersion: 1`, `title`, `notes`, `chiefComplaint`, `history`, `exam`, `assessment`, `plan`, `prescriptions` (lista de textos), `followUp`, `appointmentId`, `aiDraft` |
| `salon_service_record` | tipo `service_record` | `schemaVersion: 1`, `title`, `servicesDone`, `productsUsed`, `clientPreferences`, `nextVisit`, `notes`, `appointmentId`, `aiDraft` |

Todo campo é texto, menos `prescriptions`; o que não foi dito vai como texto vazio. `notes` sempre traz a nota inteira legível, então um editor que guarda só `notes` não perde nada.

## Envio do áudio

- Envie um pedaço a cada cerca de 10 s, numerados a partir de 0, em qualquer ordem. Repetir um `seq` é seguro e não muda nada.
- Limites: 2 MB por pedaço, 540 pedaços (90 minutos) e 96 MB por consulta; além disso a resposta é `413` com `too_long` ou `too_large`.
- Grave opus a cerca de 32 kbit/s (`audioBitsPerSecond: 32000`): 20 minutos ficam perto de 5 MB.
- Os envios de pedaços não contam no limite de requisições por minuto.

```js
const rec = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 32000 });
let seq = 0;
rec.ondataavailable = (e) =>
  fetch(`/rook/consultations/${id}/chunks/${seq++}`, { method: "PUT", headers: { "Content-Type": "audio/webm" }, body: e.data });
rec.start(10_000);
```

(a sua rota repassa o pedaço ao Rook com a chave de parceiro; nunca exponha a chave no navegador.)

## Estados

| Estado | Significa |
| --- | --- |
| `recording` | Aceita pedaços. |
| `processing` | Depois do `finish`. Consulte o `GET` a cada poucos segundos. |
| `drafted` | A nota está no prontuário; `draftEntryId` a nomeia. |
| `failed` | Com `error.code`: `no_audio`, `no_speech`, `transcription_failed`, `transcription_unavailable` (o cliente não tem provedor de fala configurado; o Rook avisa os administradores do parceiro), `model_failed`, `connector_failed`, `record_not_found`, `credit_exhausted` ou `internal`. |

`finish` duas vezes responde o estado atual. `finish` ou `reprocess` numa consulta `failed` a processa de novo a partir dos pedaços guardados. Criar ou finalizar com o crédito do cliente esgotado responde `402 { "error": "allowance_exhausted" }`.

## O que o Rook faz

Concatena os pedaços, transcreve em português pelo provedor de fala configurado (gravações longas são cortadas em segmentos transcritos em paralelo e costurados em ordem), identifica quem fala (`professional`, `patient` ou `unknown`) com uma passada curta de modelo rápido, faz o Escriba preencher o modelo com um prompt explícito e versionado, e grava o rascunho. Os tempos de fala são estimativas. A transcrição e o uso de modelo são cobrados da cota do cliente, como qualquer outro uso.

## Ações combinadas

Além da nota, o Rook lista o que a conversa **combinou fazer depois**, como propostas. Nada é executado até o seu produto chamar `actions/apply` com as ações que o profissional aprovou. Só entram ações realmente combinadas; o Rook nunca sugere nem completa uma.

`GET .../consultations/{id}` (estado `drafted`) traz `actions`:

```json
{ "actions": [{
    "id": "a1", "kind": "follow_up", "title": "Retorno", "detail": "Retorno na terça que vem às 14h.",
    "status": "proposed", "evidence": [3, 4],
    "payload": { "startsAt": "2026-12-08T14:00:00-03:00", "durationMinutes": 30, "reason": "Revisão", "whenText": "terça que vem às 14h" },
    "check": { "available": false, "conflict": "Outro atendimento", "suggestion": "2026-12-08T15:00:00-03:00" }
}] }
```

`evidence` são posições (a partir de 0) em `transcript`. `status` é `proposed`, `applied`, `failed` (com `error`, um código curto) ou `skipped`. Uma ação sem evidência na transcrição nunca é listada.

| `kind` | `payload` |
| --- | --- |
| `follow_up` | `startsAt` (ISO 8601 com deslocamento, calculado da data da consulta e do fuso da clínica) ou `range: { from, to }` quando a data foi vaga; `whenText` (as palavras ditas), `durationMinutes`, `reason`, `professional`. Pelo menos um entre `startsAt`, `range`, `whenText`. |
| `prescription` | `items`: `[{ drug, dose?, posology?, duration? }]`, como foi dito, nunca completado. |
| `exam_request` | `exams`: nomes como ditos; `indication?`. |
| `certificate` | `type?`, `days?`. |
| `patient_message` | `text`: mensagem curta, só quando houve orientação. |

O fuso da clínica é o `context.timezone` da consulta, se você o enviar (nome IANA, como `America/Sao_Paulo`), senão o do cliente, senão o `timezone` do modelo, senão UTC.

**`check`** aparece num `follow_up` com `startsAt` exato quando o conector oferece uma ferramenta de disponibilidade e/ou de conflitos: `{ available, conflict?, suggestion? }`. Sem elas, fica de fora.

```http
POST .../consultations/{id}/actions/apply
{ "actionIds": ["a1", "a2"], "edits": { "a1": { "startsAt": "2026-12-09T09:00:00-03:00" } } }
→ { "actions": [ { "id": "a1", "status": "applied", ... }, { "id": "a2", "status": "failed", "error": "connector_failed", ... } ] }
```

- `edits` muda os campos citados de uma ação, como o profissional corrigiu (um novo `startsAt` substitui um `range`); é validado pelo `kind` da ação (`400 invalid_edit`). Id desconhecido é `400 unknown_action`. A consulta precisa estar `drafted` (`409 not_drafted`).
- Cada ação roda na ferramenta do conector do seu `kind`, **como a pessoa que pediu** (os cabeçalhos `X-Rook-*` de [Quem está pedindo](/partners/connector/#quem-est%C3%A1-pedindo)). Leva o payload, `clientId`, `appointmentId`, `consultationId`, `actionId` e `idempotencyKey` (`<consultationId>:<actionId>`).
- **Idempotente por id de ação:** aplicar de novo uma ação `applied` não chama o conector outra vez e responde `applied`. Uma `failed` pode ser aplicada de novo. Uma que outra chamada está aplicando responde `skipped` com `error: "in_progress"`.
- `skipped` com `error: "no_tool"` significa que o conector não tem ferramenta para aquele `kind`.
- Toda execução é auditada (ids, tipo, ferramenta, resultado; nunca o conteúdo).

As ferramentas são achadas na lista do conector pelo nome; defina `consultationActions.tools` no modelo do parceiro para nomeá-las você mesmo (necessário se o conector tem mais de 20 ferramentas):

| Para quê | Chave no modelo | Achada por nome como |
| --- | --- | --- |
| disponibilidade de um horário | `availability` | `..._availability` |
| conflitos num horário | `conflicts` | `..._conflicts` |
| criar o agendamento | `follow_up` | `appointments_create` |
| rascunho de receita | `prescription` | `draft_prescription` |
| rascunho de pedido de exame | `exam_request` | `draft_exam_request` |
| rascunho de atestado | `certificate` | `draft_certificate` |
| mensagem ao paciente | `patient_message` | `draft_message` |

Disponibilidade e conflitos recebem `{ start, end, durationMinutes, professional?, clientId, timezone }`; respondem `{ available: boolean, suggestion? }` e `{ conflicts: [...] }`, sem identificar outros pacientes. No SDK, `Rook.applyConsultationActions(consultationId, actionIds, edits?)` chama esta rota ([IA nas suas telas](/partners/inline-ai/)).

## Privacidade e retenção

- Áudio, transcrição e nota ficam **somente em armazenamento de objetos cifrado**, nunca em linhas de banco, e vão apenas para os provedores de fala e de modelo configurados e para o conector do cliente.
- **Nunca** são usados para treinamento nem escritos em logs ou eventos de segurança.
- Criar, ler (um `GET` que devolve a transcrição) e apagar são **auditados, sem o conteúdo**.
- O áudio e a transcrição são apagados `retentionDays` dias depois do fim do atendimento (padrão 30; de 1 a 365; o padrão do parceiro é definido com a equipe do Rook), ou 2 horas depois do último pedaço de uma gravação abandonada, ou **na hora** com `DELETE`.
- Depois disso a consulta responde `404` e resta apenas um registro mínimo (nomes e texto do consentimento removidos).
