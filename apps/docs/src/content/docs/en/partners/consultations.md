---
title: "Consultation recording"
description: "From a visit's audio to a draft note in the record, without signing."
sidebar:
  order: 8
---

A partner whose customers keep records (a clinic, a salon) can send Rook the audio of a visit and get back a **draft** note in the customer's record. **Rook never signs**: the professional reviews, edits and signs in your product.

The routes are scoped to one customer and use the same partner key, the same `401` for a wrong key and the same `404` for a customer or consultation that is missing or belongs to another partner. Your [connector](/en/partners/connector/) needs the record tools.

## The flow

1. Your product creates the consultation, with the consent.
2. It uploads the audio in chunks, about every 10 seconds.
3. It calls `finish`. Rook transcribes, labels who speaks and fills the note template.
4. Rook creates or updates the draft through your connector.
5. Your product polls the state until `drafted` and shows the note to the professional, who reviews and signs.

```http
POST /tenants/{externalTenantId}/consultations
{
  "externalUserId": "doctor-1",
  "template": "prontu_evolution",
  "context": { "clientId": "c-123", "appointmentId": "a-9",
               "professionalName": "Dr. Lima", "clientName": "Maria" },
  "consent": { "obtained": true, "at": "2026-12-01T10:00:00Z", "method": "verbal" },
  "retentionDays": 30
}
→ { "consultationId": "..." }

PUT    .../consultations/{id}/chunks/{seq}   raw audio, Content-Type: audio/webm or audio/ogg
→ { "ok": true }
POST   .../consultations/{id}/finish
→ { "state": "processing" }
POST   .../consultations/{id}/reprocess      a failed consultation again, from its stored chunks
GET    .../consultations/{id}
→ { "state": "drafted", "transcript": [{ "speaker": "professional", "startMs": 0, "text": "..." }],
    "note": { }, "draftEntryId": "..." }
DELETE .../consultations/{id}                deletes the audio and transcript now
```

## Consent

The patient's consent is **yours** to obtain, before you create the consultation, and is stored with it. `consent.obtained` must be `true`; `method` is `verbal` or `written`; `text` is optional. Without consent the creation is refused.

## Note templates

| `template` | Record entry | Fields |
| --- | --- | --- |
| `prontu_evolution` | type `evolution` | `schemaVersion: 1`, `title`, `notes`, `chiefComplaint`, `history`, `exam`, `assessment`, `plan`, `prescriptions` (list of strings), `followUp`, `appointmentId`, `aiDraft` |
| `salon_service_record` | type `service_record` | `schemaVersion: 1`, `title`, `servicesDone`, `productsUsed`, `clientPreferences`, `nextVisit`, `notes`, `appointmentId`, `aiDraft` |

Every field is text except `prescriptions`; what was not said is an empty string. `notes` always holds the whole note as readable text, so an editor that keeps only `notes` loses nothing.

## Uploading audio

- Upload a chunk about every 10 s, numbered from 0, in order or not. Repeating a `seq` is safe and changes nothing.
- Limits: 2 MB per chunk, 540 chunks (90 minutes) and 96 MB per consultation; past that the answer is `413` with `too_long` or `too_large`.
- Record opus at about 32 kbit/s (`audioBitsPerSecond: 32000`): 20 minutes stay near 5 MB.
- Chunk uploads are not counted against the per-minute request limit.

```js
const rec = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 32000 });
let seq = 0;
rec.ondataavailable = (e) =>
  fetch(`/rook/consultations/${id}/chunks/${seq++}`, { method: "PUT", headers: { "Content-Type": "audio/webm" }, body: e.data });
rec.start(10_000);
```

(Your route forwards the chunk to Rook with the partner key; never expose the key in the browser.)

## States

| State | Meaning |
| --- | --- |
| `recording` | Accepting chunks. |
| `processing` | After `finish`. Poll the `GET` every few seconds. |
| `drafted` | The note is in the record; `draftEntryId` names it. |
| `failed` | With `error.code`: `no_audio`, `no_speech`, `transcription_failed`, `model_failed`, `connector_failed`, `record_not_found`, `credit_exhausted` or `internal`. |

`finish` twice answers the current state. `finish` or `reprocess` on a `failed` consultation processes it again from the stored chunks. Creating or finishing when the customer's credit is used up answers `402 { "error": "allowance_exhausted" }`.

## What Rook does

Rook concatenates the chunks, transcribes them in Portuguese through the configured speech provider (long recordings are cut into segments transcribed in parallel and stitched in order), labels who speaks (`professional`, `patient` or `unknown`) with a short pass on the fast model, has the Escriba fill the template with an explicit, versioned prompt, and files the draft. Speaker times are estimates. Transcription and model use are charged to the customer's allowance like any other use.

## Privacy and retention

- Audio, transcript and note are stored **only in sealed object storage**, never in database rows, and sent only to the configured speech and model providers and to the customer's connector.
- They are **never** used for training and never written to logs or security events.
- Creating, reading (a `GET` that returns the transcript) and deleting are **audited, without the content**.
- Audio and transcript are deleted `retentionDays` days after the visit finished (default 30; 1 to 365; the partner default is set with the Rook team), or 2 hours after the last chunk of an abandoned recording, or **at once** on `DELETE`.
- Afterwards the consultation answers `404` and only a bare record remains (names and consent wording removed).
