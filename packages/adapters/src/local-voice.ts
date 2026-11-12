import type {
  AdapterContext,
  AdapterDescriptor,
  SpeechClip,
  VoiceCapabilities,
  VoiceInfo,
  VoiceProvider,
  VoiceSynthesizeRequest,
  VoiceTranscribeRequest,
  VoiceTranscribeResult,
  VoiceVerifyResult,
} from "@corvo/adapter-kit";
import type { LocalListenLanguage } from "@corvo/contracts";
import { LOCAL_LISTEN_LANGUAGES, LOCAL_VOICE_PROVIDER_ID } from "@corvo/contracts";
import { decodeAudio } from "./audio-decode.js";
import type { LocalModelStore } from "./local-speech-models.js";
import { chooseLocalVoice } from "./local-voices.js";
import { splitForSpeech } from "./speech-chunks.js";
import { encodeWav, type SpeechSynthesizer } from "./speech-synthesizer.js";
import type { SpeechTranscriber } from "./speech-transcriber.js";

export { LOCAL_VOICE_PROVIDER_ID };

export type LocalVoiceLanguage = LocalListenLanguage;

/** What the owner chose, stored as the connection's secret: no key exists for this provider. */
export function parseLocalVoiceSecret(plaintext: string): {
  model: string;
  language: LocalVoiceLanguage;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new Error("The local voice connection has no model.");
  }
  const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const model = typeof record.model === "string" ? record.model.trim() : "";
  if (!model) throw new Error("The local voice connection has no model.");
  const language = record.language ?? "auto";
  if (!LOCAL_LISTEN_LANGUAGES.includes(language as LocalVoiceLanguage)) {
    throw new Error("The local voice connection has an unknown language.");
  }
  return { model, language: language as LocalVoiceLanguage };
}

export interface LocalVoiceDeps {
  store: Pick<LocalModelStore, "ensure" | "list" | "spec" | "specs">;
  transcriber: SpeechTranscriber;
  synthesizer: SpeechSynthesizer;
}

/** Listening and speaking on the owner's own computer. No key, nothing leaves the machine. */
export class LocalVoiceProvider implements VoiceProvider {
  constructor(private readonly deps: LocalVoiceDeps) {}

  describe(): AdapterDescriptor<VoiceCapabilities> {
    return {
      id: LOCAL_VOICE_PROVIDER_ID,
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { catalog: true, synthesize: true, transcribe: true },
    };
  }

  async verify(_secret: string, _context: AdapterContext): Promise<VoiceVerifyResult> {
    return { ok: true };
  }

  /** The voices that are on this computer. */
  async listVoices(_secret: string, _context: AdapterContext): Promise<VoiceInfo[]> {
    return (await this.deps.store.list())
      .filter((model) => model.kind === "speak" && model.state === "ready")
      .map((voice) => ({ id: voice.id, label: voice.label }));
  }

  /**
   * Speaks with the voice that fits the reply's language among those on this computer, and
   * fetches one when none is there yet. `voiceId` is the owner's choice, kept when it fits.
   */
  async synthesize(request: VoiceSynthesizeRequest, context: AdapterContext): Promise<SpeechClip> {
    // The engine fails on text with nothing to pronounce, such as a lone smiley.
    if (!/[\p{L}\p{N}]/u.test(request.text)) throw new Error("There is nothing to speak.");
    const signal = request.signal ?? context.signal;
    const ready = (await this.deps.store.list())
      .filter((model) => model.kind === "speak" && model.state === "ready")
      .map((model) => model.id);
    const id = chooseLocalVoice({
      language: request.language,
      selected: request.voiceId,
      ready,
      voices: this.deps.store.specs("speak"),
    });
    const voice = this.deps.store.spec(id)?.voice;
    if (!voice) throw new Error("That voice is not available.");
    const modelDir = await this.deps.store.ensure(id, { signal });
    const speech = await this.deps.synthesizer.synthesize({
      text: request.text,
      modelDir,
      voice,
      signal,
    });
    return { bytes: encodeWav(speech.samples, speech.sampleRate), mimeType: "audio/wav" };
  }

  async transcribe(
    request: VoiceTranscribeRequest,
    context: AdapterContext,
  ): Promise<VoiceTranscribeResult> {
    const { model, language } = parseLocalVoiceSecret(request.apiKey);
    // Decode first: audio this version cannot read must not start a model download.
    const audio = await decodeAudio(request.audio, request.mimeType);
    const signal = request.signal ?? context.signal;
    const modelDir = await this.deps.store.ensure(model, { signal });
    // The engine reads only the first 30 seconds, so a long note goes through in windows. The
    // first window settles the language, so one note is never read as two.
    // An explicit language is the owner's word. Otherwise the model listens for every language it
    // knows: the language of the app is not the language they speak.
    let spoken: string | undefined = language === "auto" ? undefined : language;
    const texts: string[] = [];
    let heard: string | undefined;
    for (const pcm of splitForSpeech(audio.pcm, audio.sampleRate)) {
      const part = await this.deps.transcriber.transcribe({
        pcm,
        sampleRate: audio.sampleRate,
        language: spoken,
        modelDir,
        signal,
      });
      if (part.text.trim()) texts.push(part.text.trim());
      heard ??= part.language;
      spoken ??= part.language;
    }
    return { text: texts.join(" "), ...(heard ? { language: heard } : {}) };
  }
}
