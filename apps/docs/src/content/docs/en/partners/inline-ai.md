---
title: "AI in your own screens"
description: "Run tasks and record consultations inside your own forms, without opening a chat."
sidebar:
  order: 10
---

The assistant does not have to be a chat window. Two calls put the AI **inside your own screens**: `Rook.ask` returns the result of a task as JSON, and `Rook.recorder` records the visit in your form and hands back the fields already filled in. Your product shows everything to the professional, who reviews it and only then saves. **Rook never writes anything to your system.**

The calls use the customer's Chief, models and credit, like any conversation, and work only while the customer is active and has credit.

```html
<script src="https://app.rook.team/sdk.js"></script>
<script>
  // Optional: with a <corvo-assistant> on the page, its session is shared and this is not needed.
  Rook.configure({ sessionUrl: "/rook/session" });
</script>
```

`sessionUrl` is the same route as in the [quickstart](/en/partners/quickstart/): your backend answers `{ "code": "..." }` and the partner key never reaches the browser.

It is the same `sdk.js` as the `<corvo-assistant>` element, so one script serves both. When the element is on the page (the [launcher](/en/partners/sdk/), for instance), `Rook.ask` and `Rook.recorder` sign in through it: its `session-url` and `origin`, and a single session shared by every call. Without the element they sign in on their own, with the `sessionUrl` you configure; `Rook.configure({ getToken })` replaces both. Pages that still load `sdk-assist.js` keep working: it only loads `sdk.js`.

## Tasks by name

Define tasks once in the partner [template](/en/partners/central/), under `assist`, and call them by name. A clinic template might ship `evolution`, `anamnesis` and `prescription_draft`; a salon one, `best_slot` and `customer_summary`.

```json
{
  "assist": {
    "anamnesis": {
      "task": "Fill in the anamnesis from the conversation or the notes.",
      "instructions": "Invent nothing; what is not there stays empty.",
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

## A button in your form

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
    else showMessage("Could not generate right now.");
  } finally {
    button.disabled = false;
  }
});
```

| Field | What it does |
| --- | --- |
| `preset` | Name of a template task. The fields below, when sent, win. |
| `task`, `instructions` | The task and its rules, when you do not use a preset. Up to 2,000 and 4,000 characters. |
| `context` | What your screen knows (JSON or text, up to 64 KB). Treated as **data**, never as instructions. |
| `schema` | JSON Schema of the answer, with an object at the root, up to 16 KB. Without a `schema` the result is `{ "text": "..." }`. |
| `onText` | A function called with the text as it is written. |

The result is checked against the `schema`. If it does not fit, Rook asks **once more**, saying what was wrong; if that fails too, the call rejects with `invalid_output` instead of guessing.

Errors (`error.code`): `unknown_preset`, `invalid_schema`, `invalid_output`, `allowance_exhausted` (credit used up), `access_inactive` (customer suspended or without a plan), `model_failed`, `no_model`.

## Record the visit in your form

```js
const recorder = Rook.recorder({
  preset: "anamnesis",
  clientId: patient.id,
  clientName: patient.name,
  // Your screen asks the patient; returning false cancels.
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

The browser records audio on **your page** (`getUserMedia`) and uploads it in chunks of about 10 seconds to the [consultation recording](/en/partners/consultations/) routes, which transcribe it and label who speaks. At the end, the fields of your `schema` arrive in `onResult` for your screen to fill in.

States in `onState`: `idle`, `requesting`, `recording`, `paused`, `uploading`, `processing`, `done`, `error`. Methods: `start()`, `pause()`, `resume()`, `stop()` (resolves once the result was delivered), `cancel()` (deletes what was recorded).

- **Live captions.** While recording, `onTranscript` receives captions from the browser itself (`source: "browser"`, when it offers speech recognition). At the end, Rook's own transcript arrives (`final: true`, `source: "server"`, with `turns`).
- **Consent.** `consent` is required and is stored with the consultation, as in the API.
- **Retention.** After the result, Rook deletes the audio and transcript unless you pass `keep: true` (the consultation's retention period then applies).
- **Recording errors:** `permission_denied`, `too_long`, `upload_failed`, `allowance_exhausted`, `no_speech`, `model_failed`.

## From your server

Without a browser, the same tasks work with the partner key:

```http
POST /api/partner/v1/tenants/{externalTenantId}/ask
Authorization: Bearer cpk_...
{ "preset": "evolution", "context": { }, "stream": false }
→ { "result": { } }
```

With `"stream": true` the answer is a sequence of events (`delta`, `retry`, `result`, `error`). To record, create the consultation with `"template": "structured"` and `"context": { "clientId": "...", "output": { "preset": "anamnesis" } }`: the result comes in `note`, and nothing is filed in your connector.

## Security

- The browser uses a session of the customer, not the partner key, and accepts calls from any origin **only with the token**, never with cookies.
- Text your page sends is fenced as outside data and limited in size. It cannot change the task's rules.
- Every run writes a content-free audit event (partner, customer, task name, outcome).
