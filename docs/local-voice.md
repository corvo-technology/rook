# Talking with an agent on this computer

In the desktop app, an agent can be talked to by voice for free, with nothing to install beyond
the app and nothing sent to a hosted service: Rook listens with a speech model on the owner's own
computer (see [local-transcription.md](local-transcription.md)) and speaks with a voice that runs
there too. Paid voices (ElevenLabs, OpenAI, Cartesia, Fish Audio or a self-hosted server) stay an
option for a different sound.

## What the owner sees

- **Call** on an agent opens the voice conversation. Talk, and the agent answers aloud. The
  microphone listens for a pause to know the turn is over, and talking over the agent cuts it off.
- **Read aloud** on a message, and agents set to speak their replies, use the same voice.
- Settings → Voice → **This computer** lists the listening models and the voices, each with its
  size. A voice can be downloaded, played as a short sample, used or removed.

With no voice connected, the first conversation downloads what it needs: the speech model, and
the voice for the language of the conversation. A short message says once that this is happening
and how big it is; the reply is spoken as soon as the voice is there. The download carries on if
the person closes the conversation. A model or voice the owner removed is not fetched again by
itself; asking for a download in Settings clears that.

A voice service the owner selected is never replaced silently. If it fails to speak a reply (an
error, or no credit left) and a voice is already downloaded, that reply is read with the local
voice and a message says so once. Nothing is downloaded to cover for a service.

## Voices

| Voice | Language | Size on download | License |
|---|---|---|---|
| Português (Brasil) | Portuguese | about 67 MB | BSD-3-Clause |
| Español | Spanish | about 67 MB | BSD-3-Clause |
| Français | French | about 67 MB | BSD-3-Clause |
| Deutsch | German | about 67 MB | BSD-3-Clause |
| English | English | about 109 MB | MIT (VITS), LJSpeech is public domain |
| Kokoro (English, more natural) | English | about 132 MB | Apache-2.0 |

Each voice's license is also listed in `THIRD_PARTY_NOTICES.md`. The voices are fetched from the
sherpa-onnx project's releases over HTTPS, checked against a digest pinned in
`packages/adapters/src/local-voices.ts`, and only the files the engine reads are kept, under
`speech-models/` next to the listening models.

**Piper voices are not offered.** sherpa-onnx 2.x no longer includes the espeak-ng phonemizer that
Piper voices need (it is GPL-3.0), and several Piper voices carry non-commercial dataset licenses.
The Portuguese, Spanish, French and German voices are character-based Coqui VITS models, which
need no phonemizer. The English voice is a VITS model trained on LJSpeech that reads from a
pronunciation lexicon, and Kokoro speaks English from its own lexicon. Kokoro's other languages (including
Brazilian Portuguese) would need an external phonemizer and are not offered. A Piper or Kokoro
voice for another language can be added to the catalog once the engine can pronounce it under a
license that allows it.

**Speed.** The Coqui voices and the English voice are fast: on an M1 laptop a sentence of about
five seconds of speech takes under two seconds to make. Kokoro sounds more natural and is several
times slower (four to seven seconds for the same sentence), so it is an owner's choice and not the
default; on a slow computer a long reply in Kokoro can pause between sentences. When both English
voices are on this computer the English voice speaks unless the owner picked Kokoro.

## Which voice speaks

The voice follows the language of the conversation: the language the last recording was heard in
(Whisper reports it), else the language of the app. Among the voices on this computer, the one
for that language speaks; the owner's own pick wins when it speaks the language. When no voice on
this computer speaks it, the owner's pick or any voice there reads it instead; with none
downloaded, the language's own voice is fetched, and a language without one gets the English voice. The
language is a hint the client sends with each reply, not something the server guesses from the
words.

## How it works

The client asks the server to prepare a reply (`voice.prepare`), which splits it into sentences,
then fetches each sentence's audio from `/api/voice/speak` while the previous one plays, so the
first words start as soon as the first sentence is ready. If the voice is still downloading,
`prepare` answers that it is preparing and the client asks again every couple of seconds. A
recording sent to `/api/voice/transcribe` while the speech model downloads is held for up to
about 50 seconds by the server, then answered with `503` and a `VOICE_PREPARING` code, and the
client sends it again.

Audio is 16-bit mono WAV.

**Crash isolation.** The speech engines are native code, and some inputs can crash them. Synthesis
and transcription each run in a child process of their own (`speech-process.ts`), one request at a
time, with the model kept loaded between requests and the process ended after idle minutes to give
the memory back. The API is never inside it: a crash (or a request that takes too long, or one the
client cancelled) fails only the sentence or recording in flight, is logged, and the next request
starts a fresh process, after a short wait that grows while crashes repeat. The reply then falls
back to text, as for any voice that fails. The process is the app's own binary run as plain Node,
the way the engine that hosts the API runs. When a call starts, the client asks `voice.warm`, which
loads the voice and the listening model in the background (only what is already on this computer,
never a download) so the first turn does not wait for them.

| Piece | Where |
|---|---|
| The voice catalog and which voice speaks | `packages/adapters/src/local-voices.ts` |
| Download, storage, opt-out | `packages/adapters/src/local-speech-models.ts` |
| The child process that runs an engine | `packages/adapters/src/speech-process.ts` |
| The speech engine, in a child process | `packages/adapters/src/sherpa-tts-synthesizer.ts` |
| The "This computer" provider | `packages/adapters/src/local-voice.ts` |
| Defaults, preparing, falling back | `apps/api/src/voice.ts`, `apps/api/src/local-voice.ts` |
| Playback and the notices | `apps/web/src/lib/tts.ts`, `apps/web/src/lib/voice-notices.ts` |
| Settings | `apps/web/src/pages/LocalSpeechSection.tsx` |

## Where it works

Only the desktop app: the engine is enabled where `CORVO_DESKTOP_STACK_TOKEN` is set, which only
the embedded engine sets, and the desktop app also turns calls on (`PHONE_CALLS_ENABLED`). A web
or server deployment, and the mobile app, keep using a hosted voice provider; they never offer or
download a model. Group chats have no call; read aloud works on their messages.

## Testing

Tests are offline and use a scripted engine. To run the real engine on a voice you downloaded:

```sh
RUN_LOCAL_SPEECH_ENGINE=1 \
LOCAL_VOICE_DIR=<the voice's folder under speech-models/> \
LOCAL_VOICE_ID=voice-pt \
pnpm exec vitest run packages/adapters/src/sherpa-tts-synthesizer.test.ts
```

A text that has nothing to pronounce (a lone smiley) would stop the engine, so the provider
refuses it before it reaches the engine.
