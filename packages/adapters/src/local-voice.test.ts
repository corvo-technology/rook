import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioDecodeError, UnsupportedAudioFormatError } from "./audio-decode.js";
import { LOCAL_SPEECH_MODELS } from "./local-speech-models.js";
import { LocalVoiceProvider, parseLocalVoiceSecret } from "./local-voice.js";
import { LOCAL_VOICES } from "./local-voices.js";
import { ScriptedSynthesizer } from "./speech-synthesizer.js";
import { ScriptedTranscriber } from "./speech-transcriber.js";

const ctx = {
  operationId: "voice",
  traceId: "voice",
  spaceId: "w",
  userId: "u",
  signal: new AbortController().signal,
};

/** A PCM16 mono WAV at 16 kHz, half a second long. */
function wav() {
  const frames = 8000;
  const data = Buffer.alloc(frames * 2, 1);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return new Uint8Array(Buffer.concat([header, data]));
}

/** A PCM16 mono WAV at 16 kHz, `seconds` long. */
function wavOf(seconds: number) {
  const data = Buffer.alloc(seconds * 16000 * 2, 1);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return new Uint8Array(Buffer.concat([header, data]));
}

/** The shipped catalog as a store would list it, with `ready` models on this computer. */
function fakeStore(ready: string[] = []) {
  const models = [...LOCAL_SPEECH_MODELS, ...LOCAL_VOICES];
  return {
    ensure: vi.fn(async (id: string, _options?: { signal?: AbortSignal }) => `/models/${id}`),
    list: vi.fn(async () =>
      models.map((model) => ({
        id: model.id,
        kind: model.kind,
        label: model.label,
        sizeBytes: model.sizeBytes,
        languages: [...model.languages],
        state: ready.includes(model.id) ? ("ready" as const) : ("absent" as const),
        bytesDone: 0,
      })),
    ),
    spec: (id: string) => models.find((model) => model.id === id),
    specs: (kind: "listen" | "speak") => models.filter((model) => model.kind === kind),
  };
}

function provider(
  respond?: ConstructorParameters<typeof ScriptedTranscriber>[0],
  ready: string[] = [],
) {
  const store = fakeStore(ready);
  const transcriber = new ScriptedTranscriber(respond);
  const synthesizer = new ScriptedSynthesizer();
  return {
    store,
    transcriber,
    synthesizer,
    provider: new LocalVoiceProvider({ store, transcriber, synthesizer }),
  };
}

const secret = (language = "auto") => JSON.stringify({ model: "base", language });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LocalVoiceProvider", () => {
  it("transcribes through the transcriber and returns the detected language", async () => {
    const {
      provider: local,
      store,
      transcriber,
    } = provider(() => ({
      text: "olá, mundo",
      language: "pt",
    }));
    const result = await local.transcribe(
      { audio: wav(), mimeType: "audio/wav", apiKey: secret() },
      ctx,
    );
    expect(result).toEqual({ text: "olá, mundo", language: "pt" });
    expect(store.ensure).toHaveBeenCalledWith("base", expect.anything());
    expect(transcriber.calls).toHaveLength(1);
    expect(transcriber.calls[0]).toMatchObject({
      modelDir: "/models/base",
      sampleRate: 16000,
      language: undefined,
    });
    expect(transcriber.calls[0]?.pcm.length).toBe(8000);
  });

  it("listens in the saved language, and detects the language when it is automatic", async () => {
    const saved = provider();
    await saved.provider.transcribe(
      { audio: wav(), mimeType: "audio/wav", apiKey: secret("es") },
      ctx,
    );
    expect(saved.transcriber.calls[0]?.language).toBe("es");
    // The app's own language is only a hint from the caller: it must not stop the model from
    // hearing a language the owner speaks that is not the one the app is in.
    const hinted = provider();
    await hinted.provider.transcribe(
      { audio: wav(), mimeType: "audio/wav", apiKey: secret("auto"), language: "pt" },
      ctx,
    );
    expect(hinted.transcriber.calls[0]?.language).toBeUndefined();
    const explicit = provider();
    await explicit.provider.transcribe(
      { audio: wav(), mimeType: "audio/wav", apiKey: secret("pt"), language: "en" },
      ctx,
    );
    expect(explicit.transcriber.calls[0]?.language).toBe("pt");
  });

  it("does not download a model or run the engine for audio it cannot read", async () => {
    const { provider: local, store, transcriber } = provider();
    await expect(
      local.transcribe(
        { audio: new Uint8Array([0x49, 0x44, 0x33, 4]), mimeType: "audio/mpeg", apiKey: secret() },
        ctx,
      ),
    ).rejects.toBeInstanceOf(UnsupportedAudioFormatError);
    await expect(
      local.transcribe({ audio: new Uint8Array(), mimeType: "audio/ogg", apiKey: secret() }, ctx),
    ).rejects.toBeInstanceOf(AudioDecodeError);
    expect(store.ensure).not.toHaveBeenCalled();
    expect(transcriber.calls).toHaveLength(0);
  });

  it("never reaches the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { provider: local } = provider();
    await local.transcribe({ audio: wav(), mimeType: "audio/wav", apiKey: secret() }, ctx);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reads Ogg/Opus voice notes", async () => {
    const tone = new Uint8Array(
      await readFile(new URL("./test-fixtures/audio/tone.ogg", import.meta.url)),
    );
    const { provider: local, transcriber } = provider();
    await local.transcribe({ audio: tone, mimeType: "audio/ogg", apiKey: secret() }, ctx);
    expect(transcriber.calls[0]?.pcm.length).toBeGreaterThan(15000);
  });

  it("transcribes a long recording in windows the engine reads whole, and joins them in order", async () => {
    // The engine reads only the first 30 seconds of what it is given.
    const longWav = wavOf(75);
    let call = 0;
    const { provider: local, transcriber } = provider(() => {
      call += 1;
      return { text: `part ${call}`, language: "pt" };
    });
    const result = await local.transcribe(
      { audio: longWav, mimeType: "audio/wav", apiKey: secret() },
      ctx,
    );
    expect(transcriber.calls.length).toBeGreaterThanOrEqual(3);
    for (const piece of transcriber.calls) expect(piece.pcm.length / 16000).toBeLessThanOrEqual(30);
    expect(result.text).toBe(transcriber.calls.map((_, index) => `part ${index + 1}`).join(" "));
    expect(result.language).toBe("pt");
  });

  it("settles the language on the first window, so one note is not read in two languages", async () => {
    const { provider: local, transcriber } = provider((input) => ({
      text: "x",
      language: input.language ? input.language : "pt",
    }));
    await local.transcribe({ audio: wavOf(70), mimeType: "audio/wav", apiKey: secret() }, ctx);
    expect(transcriber.calls[0]?.language).toBeUndefined();
    for (const piece of transcriber.calls.slice(1)) expect(piece.language).toBe("pt");
  });

  it("describes a provider that listens and speaks, with no key to verify", async () => {
    const { provider: local } = provider();
    expect(local.describe()).toMatchObject({
      id: "local",
      capabilities: { catalog: true, synthesize: true, transcribe: true },
    });
    await expect(local.verify(secret(), ctx)).resolves.toEqual({ ok: true });
  });
});

describe("LocalVoiceProvider speaking", () => {
  const speak = (
    local: LocalVoiceProvider,
    over: { text?: string; voiceId?: string; language?: string } = {},
  ) => local.synthesize({ text: "Olá, tudo bem?", voiceId: "", apiKey: secret(), ...over }, ctx);

  it("lists only the voices that are on this computer", async () => {
    expect(await provider(undefined, []).provider.listVoices(secret(), ctx)).toEqual([]);
    expect(
      await provider(undefined, ["voice-pt", "base"]).provider.listVoices(secret(), ctx),
    ).toEqual([{ id: "voice-pt", label: "Português (Brasil)" }]);
  });

  it("speaks with the voice that fits the reply's language and returns a WAV", async () => {
    const { provider: local, synthesizer } = provider(undefined, ["voice-kokoro", "voice-pt"]);
    const clip = await speak(local, { language: "pt-BR", voiceId: "voice-kokoro" });
    expect(clip.mimeType).toBe("audio/wav");
    expect(new TextDecoder().decode(clip.bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(clip.bytes.slice(8, 12))).toBe("WAVE");
    expect(synthesizer.calls[0]).toMatchObject({
      text: "Olá, tudo bem?",
      modelDir: "/models/voice-pt",
      voice: { type: "piper" },
    });
    await speak(local, { language: "en", text: "Hello there" });
    expect(synthesizer.calls[1]).toMatchObject({
      modelDir: "/models/voice-kokoro",
      voice: { type: "kokoro", speakerId: 3 },
    });
  });

  it("falls back to a voice on this computer when none matches the language", async () => {
    const { provider: local, store, synthesizer } = provider(undefined, ["voice-ljs"]);
    await speak(local, { language: "pt" });
    expect(synthesizer.calls[0]?.modelDir).toBe("/models/voice-ljs");
    // Nothing is fetched for a language that has its own voice when another one can read.
    expect(store.ensure).toHaveBeenCalledWith("voice-ljs", expect.anything());
    expect(store.ensure).not.toHaveBeenCalledWith("voice-pt", expect.anything());
  });

  it("fetches the language's own voice when none is on this computer", async () => {
    const { provider: local, store } = provider(undefined, []);
    await speak(local, { language: "es" });
    expect(store.ensure).toHaveBeenCalledWith("voice-es", expect.anything());
    await speak(local, { language: "ja" });
    expect(store.ensure).toHaveBeenCalledWith("voice-ljs", expect.anything());
  });

  it("refuses text with nothing to pronounce, which would stop the engine", async () => {
    const { provider: local, synthesizer } = provider(undefined, ["voice-pt"]);
    await expect(speak(local, { text: "...  :)" })).rejects.toThrow(/nothing to speak/i);
    expect(synthesizer.calls).toHaveLength(0);
  });

  it("hands the request's signal on, so a cancelled reply stops downloading", async () => {
    const { provider: local, store } = provider(undefined, []);
    const controller = new AbortController();
    await local.synthesize(
      { text: "Hi", voiceId: "", apiKey: secret(), language: "en", signal: controller.signal },
      ctx,
    );
    expect(store.ensure).toHaveBeenCalledWith("voice-ljs", { signal: controller.signal });
  });
});

describe("parseLocalVoiceSecret", () => {
  it("reads the model and language", () => {
    expect(parseLocalVoiceSecret(secret("en"))).toEqual({ model: "base", language: "en" });
  });

  it("rejects text that is not a model choice", () => {
    expect(() => parseLocalVoiceSecret("not json")).toThrow(/model/i);
    expect(() => parseLocalVoiceSecret(JSON.stringify({ model: "", language: "auto" }))).toThrow(
      /model/i,
    );
    expect(() => parseLocalVoiceSecret(JSON.stringify({ model: "base", language: "xx" }))).toThrow(
      /language/i,
    );
  });

  it("reads every language the owner can pick", () => {
    for (const language of ["auto", "en", "pt", "es", "fr", "de", "ja", "zh"]) {
      expect(parseLocalVoiceSecret(secret(language)).language).toBe(language);
    }
  });
});
