# Local audio transcription

An agent can act on audio the owner sends: a voice note from a chat app such as Telegram, or an
audio file attached in the web chat. Rook turns the audio into text before the agent runs and puts
the text in the message the agent reads. The original audio stays attached.

By default this happens on the owner's own computer, with a speech model that runs there. Nothing
is sent to a hosted service unless the owner chose one.

## What is covered

- Audio in the web chat, and voice notes in a 1:1 conversation with the owner's linked chat app.
- Audio from the owner. Audio from anyone else is attached as a file and is not transcribed, except a visitor who writes to a linked WhatsApp number: that is transcribed too, with the speech provider the owner chose, but never causes a model to be downloaded, and is limited to one at a time per number, the rest attached with a note (see `docs/whatsapp.md`).
- One language per recording, in any language Whisper knows. The language is detected for each
  recording; Settings → Voice can fix it to English, Portuguese, Spanish, French, German, Japanese
  or Chinese, which helps with very short recordings. The language of the app is not used to
  decide: a recording is heard in the language it is spoken in.
- WAV and Ogg/Opus (what Telegram voice notes use). Other formats, such as mp3, m4a and webm, are
  attached with a note that they were not transcribed.
- Recordings up to 8 MiB.

Spoken replies and the voice conversation are in [local-voice.md](local-voice.md). Not covered yet:
the mobile app, group channels and the team chat bridge.

## How it works for the owner

In the desktop app, Settings → Voice offers **This computer** next to the hosted providers. It lists
the speech models with their size, and each can be downloaded, used or removed. A downloaded model
stays until it is removed.

With nothing configured, the first audio downloads the default model by itself. The conversation
says so, and a chat app gets one short direct message, because the first download takes a while.
The agent runs when the text is ready, or without it if the download fails: the agent then reads a
note that the audio was not transcribed, and the owner is told once.

A hosted voice provider that transcribes (OpenAI, ElevenLabs, Fish Audio or a self-hosted server)
is used instead when it is the selected voice. A selected provider is never replaced by a download
the owner did not ask for, and audio is only sent to one the owner allowed.

## Models

| Model | Download | Kept on disk |
|---|---|---|
| Base (default) | about 208 MB | about 161 MB |
| Small (more accurate) | about 639 MB | about 375 MB |

Both are multilingual Whisper models (MIT) for the sherpa-onnx engine. They are fetched from the engine
project's releases over HTTPS and checked against a digest pinned in the code, and only the files
the engine reads are kept. They live under `speech-models/` in the engine's data directory.

## For developers

| Piece | Where |
|---|---|
| Model download and storage | `packages/adapters/src/local-speech-models.ts` |
| Audio decoding to 16 kHz mono | `packages/adapters/src/audio-decode.ts` |
| The engine, in a worker thread | `packages/adapters/src/sherpa-whisper-transcriber.ts` |
| The "This computer" voice provider | `packages/adapters/src/local-voice.ts` |
| Choosing a provider and storing transcripts | `packages/adapters/src/audio-transcription.ts` |
| The `audio.transcribe` job | `packages/adapters/src/audio-transcribe-job.ts` |
| Holding a run for its audio | `apps/api/src/audio-hold.ts` |

The engine is only enabled where `CORVO_DESKTOP_STACK_TOKEN` is set, which only the desktop app's
embedded engine does, so a server deployment never offers or downloads a model. A run that waits
for its audio is marked in `runs.awaitingAudioAt`; the job reconciler leaves it alone for up to 30
minutes, then starts it without the transcript.

Tests are offline and use a scripted transcriber. To run the real engine against a model and a clip:

```sh
RUN_LOCAL_SPEECH_ENGINE=1 \
LOCAL_SPEECH_MODEL_DIR=<folder with the model's .onnx and tokens files> \
LOCAL_SPEECH_MODEL_NAME=base \
LOCAL_SPEECH_CLIP=<a wav or ogg/opus file> \
pnpm exec vitest run packages/adapters/src/sherpa-whisper-transcriber.test.ts
```

The design and the engine spike are in `docs/superpowers/specs/`.
