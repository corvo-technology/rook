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
| `failed` | Com `error.code`: `no_audio`, `no_speech`, `transcription_failed`, `model_failed`, `connector_failed`, `record_not_found`, `credit_exhausted` ou `internal`. |

`finish` duas vezes responde o estado atual. `finish` ou `reprocess` numa consulta `failed` a processa de novo a partir dos pedaços guardados. Criar ou finalizar com o crédito do cliente esgotado responde `402 { "error": "allowance_exhausted" }`.

## O que o Rook faz

Concatena os pedaços, transcreve em português pelo provedor de fala configurado (gravações longas são cortadas em segmentos transcritos em paralelo e costurados em ordem), identifica quem fala (`professional`, `patient` ou `unknown`) com uma passada curta de modelo rápido, faz o Escriba preencher o modelo com um prompt explícito e versionado, e grava o rascunho. Os tempos de fala são estimativas. A transcrição e o uso de modelo são cobrados da cota do cliente, como qualquer outro uso.

## Privacidade e retenção

- Áudio, transcrição e nota ficam **somente em armazenamento de objetos cifrado**, nunca em linhas de banco, e vão apenas para os provedores de fala e de modelo configurados e para o conector do cliente.
- **Nunca** são usados para treinamento nem escritos em logs ou eventos de segurança.
- Criar, ler (um `GET` que devolve a transcrição) e apagar são **auditados, sem o conteúdo**.
- O áudio e a transcrição são apagados `retentionDays` dias depois do fim do atendimento (padrão 30; de 1 a 365; o padrão do parceiro é definido com a equipe do Rook), ou 2 horas depois do último pedaço de uma gravação abandonada, ou **na hora** com `DELETE`.
- Depois disso a consulta responde `404` e resta apenas um registro mínimo (nomes e texto do consentimento removidos).
