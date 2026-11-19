---
title: "IA nas suas telas"
description: "Peça tarefas e grave consultas dentro dos seus próprios formulários, sem abrir um chat."
sidebar:
  order: 10
---

O assistente não precisa ser uma janela de chat. Duas chamadas deixam a IA **dentro das suas telas**: `Rook.ask` devolve o resultado de uma tarefa em JSON, e `Rook.recorder` grava a consulta no seu formulário e devolve os campos já preenchidos. O seu produto mostra tudo ao profissional, que revisa e só então salva. **O Rook nunca grava nada no seu sistema.**

As chamadas usam o Chief, os modelos e o crédito do cliente, como qualquer conversa, e valem só enquanto o cliente está ativo e com crédito.

```html
<script src="https://app.rook.team/sdk.js"></script>
<script>
  // Opcional: com um <corvo-assistant> na página, a sessão dele é compartilhada e isto não é preciso.
  Rook.configure({ sessionUrl: "/rook/session" });
</script>
```

A rota `sessionUrl` é a mesma do [quickstart](/partners/quickstart/): o seu backend devolve `{ "code": "..." }` e a chave de parceiro nunca chega ao navegador.

É o mesmo `sdk.js` do elemento `<corvo-assistant>`, então um só script serve aos dois. Com o elemento na página (o [launcher](/partners/sdk/), por exemplo), `Rook.ask` e `Rook.recorder` entram por ele: usam o `session-url` e o `origin` dele, e uma única sessão compartilhada por todas as chamadas. Sem o elemento, entram sozinhos, com o `sessionUrl` que você configurar; `Rook.configure({ getToken })` substitui os dois. Páginas que ainda carregam `sdk-assist.js` continuam funcionando: ele só carrega o `sdk.js`.

## Tarefas por nome

Defina tarefas uma vez no [modelo](/partners/central/) do parceiro, em `assist`, e chame pelo nome. Um modelo de clínica pode trazer `evolution`, `anamnesis` e `prescription_draft`; um de salão, `best_slot` e `customer_summary`.

```json
{
  "assist": {
    "anamnesis": {
      "task": "Preencha a anamnese a partir da conversa ou das anotações.",
      "instructions": "Não invente nada; o que não consta fica vazio.",
      "schema": {
        "type": "object",
        "properties": {
          "chiefComplaint": { "type": "string" },
          "allergies": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["chiefComplaint"]
      }
    }
  }
}
```

## Um botão no formulário

```js
button.addEventListener("click", async () => {
  button.disabled = true;
  try {
    const { result } = await Rook.ask({
      preset: "evolution",
      context: { notes: form.notes.value, patient: patient.summary },
    });
    form.chiefComplaint.value = result.chiefComplaint;
    form.plan.value = result.plan;
  } catch (error) {
    if (error.code === "allowance_exhausted") showBuyMore();
    else showMessage("Não foi possível gerar agora.");
  } finally {
    button.disabled = false;
  }
});
```

| Campo | Para quê |
| --- | --- |
| `preset` | Nome de uma tarefa do modelo. Os campos abaixo, se enviados, valem mais. |
| `task`, `instructions` | A tarefa e as regras, quando não usa um preset. Até 2.000 e 4.000 caracteres. |
| `context` | O que a sua tela sabe (JSON ou texto, até 64 KB). É tratado como **dado**, nunca como instrução. |
| `schema` | JSON Schema da resposta, com objeto na raiz e até 16 KB. Sem `schema`, o resultado é `{ "text": "..." }`. |
| `onText` | Função chamada com o texto à medida que ele é escrito. |

O resultado é validado contra o `schema`. Se não servir, o Rook pergunta **uma vez mais**, dizendo o que estava errado; se falhar de novo, a chamada rejeita com `invalid_output`, sem chutar.

Erros (`error.code`): `unknown_preset`, `invalid_schema`, `invalid_output`, `allowance_exhausted` (crédito acabou), `access_inactive` (cliente suspenso ou sem plano), `model_failed`, `no_model`.

## Gravar a consulta no formulário

```js
const recorder = Rook.recorder({
  preset: "anamnesis",
  clientId: patient.id,
  clientName: patient.name,
  // A sua tela pergunta ao paciente; devolver false cancela.
  consent: async () => (await confirmConsent()) && { method: "verbal" },
  onState: (state) => (recordButton.dataset.state = state),
  onPermission: (p) => p === "denied" && showMicHelp(),
  onTranscript: ({ text, final, source }) => captions.render(text, final),
  onResult: (fields) => {
    form.chiefComplaint.value = fields.chiefComplaint;
    form.allergies.value = fields.allergies.join(", ");
  },
  onError: (error) => showMessage(error.code),
});

recordButton.onclick = () => (recorder.state === "recording" ? recorder.stop() : recorder.start());
pauseButton.onclick = () => (recorder.state === "paused" ? recorder.resume() : recorder.pause());
```

O navegador grava o áudio na **sua página** (`getUserMedia`) e envia em pedaços de cerca de 10 segundos para as rotas de [gravação de consultas](/partners/consultations/), que fazem a transcrição e a identificação de quem fala. No fim, os campos do `schema` chegam em `onResult`, para a sua tela preencher.

Estados em `onState`: `idle`, `requesting`, `recording`, `paused`, `uploading`, `processing`, `done`, `error`. Métodos: `start()`, `pause()`, `resume()`, `stop()` (resolve quando o resultado foi entregue), `cancel()` (apaga o que foi gravado).

- **Legenda ao vivo.** Enquanto grava, `onTranscript` recebe legendas do próprio navegador (`source: "browser"`, quando ele oferece reconhecimento de voz). Ao fim, chega a transcrição do Rook (`final: true`, `source: "server"`, com `turns`).
- **Consentimento.** `consent` é obrigatório e fica registrado na consulta, como na API.
- **Retenção.** Depois do resultado, o Rook apaga o áudio e a transcrição, a menos que você passe `keep: true` (vale então o prazo de retenção da consulta).
- **Erros de gravação:** `permission_denied`, `too_long`, `upload_failed`, `allowance_exhausted`, `no_speech`, `model_failed`.

## Do seu servidor

Sem navegador, as mesmas tarefas valem com a chave de parceiro:

```http
POST /api/partner/v1/tenants/{externalTenantId}/ask
Authorization: Bearer cpk_...
{ "preset": "evolution", "context": { }, "stream": false }
→ { "result": { } }
```

Com `"stream": true` a resposta é uma sequência de eventos (`delta`, `retry`, `result`, `error`). Para gravar, crie a consulta com `"template": "structured"` e `"context": { "clientId": "...", "output": { "preset": "anamnesis" } }`: o resultado vem em `note`, e nada é arquivado no seu conector.

## Segurança

- O navegador usa uma sessão do cliente, sem a chave de parceiro, aceita de qualquer origem **só com o token**, sem cookies.
- O texto que a sua página envia é delimitado como dado de fora e limitado em tamanho. Ele não muda as regras da tarefa.
- Cada execução gera um evento de auditoria sem conteúdo (parceiro, cliente, nome da tarefa, resultado).
