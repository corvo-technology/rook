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
import { readVoiceAudio, readVoiceJson, speechUploadName, voiceDeadline } from "./voice-http.js";

/**
 * Speech through the deployment's own OpenRouter key, paid from the customer's credit. It is not
 * a catalog entry: nobody connects it, the API picks it when no voice of their own is connected.
 * The `apiKey` of every request is the deployment key and goes nowhere but openrouter.ai.
 */
export const OPENROUTER_VOICE_PROVIDER_ID = "openrouter";
/** The two models voice on credits runs, the one place to change them. */
export const OPENROUTER_TTS_MODEL = "google/gemini-3.8-flash-lite-tts";
export const OPENROUTER_STT_MODEL = "openai/whisper-large-v3-turbo";
/**
 * Catalog prices in US dollars (https://openrouter.ai/api/v1/models), used to size holds.
 * Speech is priced in tokens: about 25 audio tokens ($0.000006 each) per second of speech, read at
 * about 15 characters a second, plus the text going in, is about $0.0000105 a character.
 */
export const OPENROUTER_TTS_USD_PER_CHAR = 0.0000105;
export const OPENROUTER_STT_USD_PER_SECOND = 0.0000034;
/** Gemini speech prices: text in per token, audio out at about 25 tokens a second. */
const TTS_USD_PER_INPUT_TOKEN = 0.0000005;
const TTS_USD_PER_AUDIO_TOKEN = 0.000006;
const TTS_AUDIO_TOKENS_PER_SECOND = 25;
/** Gemini voices are multilingual, so one voice reads every language, Brazilian Portuguese included. */
export const OPENROUTER_DEFAULT_VOICE = "Kore";
const OPENROUTER_VOICE_IDS = [
  "Kore",
  "Puck",
  "Zephyr",
  "Charon",
  "Fenrir",
  "Leda",
  "Orus",
  "Aoede",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat",
];

/** Gemini speech comes back as raw 16-bit mono PCM at 24 kHz, which no player opens as it is. */
const PCM_SAMPLE_RATE = 24_000;

function pcmToWav(pcm: Uint8Array): Uint8Array {
  const wav = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(wav.buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++)
      view.setUint8(offset + index, value.charCodeAt(index));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, PCM_SAMPLE_RATE, true);
  view.setUint32(28, PCM_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  wav.set(pcm, 44);
  return wav;
}

/**
 * What a spoken clip cost, from the length of the audio it returned. The reply carries no price,
 * and the clip's length is what the audio tokens bill, so this tracks the real charge closely.
 */
export function openRouterSpeechCostUsd(text: string, clip: SpeechClip): number {
  const seconds = Math.max(0, clip.bytes.byteLength - 44) / (PCM_SAMPLE_RATE * 2);
  return (
    Math.ceil(text.length / 4) * TTS_USD_PER_INPUT_TOKEN +
    seconds * TTS_AUDIO_TOKENS_PER_SECOND * TTS_USD_PER_AUDIO_TOKEN
  );
}

/** Whisper names the language it heard ("portuguese"); other providers give the code ("pt"). */
const LANGUAGE_CODES: Record<string, string> = {
  english: "en",
  portuguese: "pt",
  spanish: "es",
  french: "fr",
  german: "de",
  italian: "it",
  japanese: "ja",
  chinese: "zh",
};

function heardLanguage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const lower = value.trim().toLowerCase();
  const code = LANGUAGE_CODES[lower] ?? lower.split("-")[0];
  return code && /^[a-z]{2,3}$/.test(code) ? code : undefined;
}

const SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech";
const TRANSCRIPTION_URL = "https://openrouter.ai/api/v1/audio/transcriptions";
const SPEAK_DEADLINE_MS = 60_000;
const TRANSCRIBE_DEADLINE_MS = 60_000;

/** A voice the customer's own bot may carry belongs to another provider; only ours are spoken. */
export function openRouterVoiceId(voiceId: string | undefined): string {
  return voiceId && OPENROUTER_VOICE_IDS.includes(voiceId) ? voiceId : OPENROUTER_DEFAULT_VOICE;
}

function failure(status: number, what: string): Error {
  // The deployment's account is the operator's concern; the customer only learns it failed.
  return new Error(`Voice is unavailable right now (${what} failed, status ${status}).`);
}

export class OpenRouterVoiceProvider implements VoiceProvider {
  constructor(private readonly fetcher: typeof globalThis.fetch = globalThis.fetch) {}

  describe(): AdapterDescriptor<VoiceCapabilities> {
    return {
      id: OPENROUTER_VOICE_PROVIDER_ID,
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { catalog: false, synthesize: true, transcribe: true },
    };
  }

  async verify(): Promise<VoiceVerifyResult> {
    return { ok: true };
  }

  async listVoices(): Promise<VoiceInfo[]> {
    return OPENROUTER_VOICE_IDS.map((id) => ({
      id,
      label: id,
    }));
  }

  async synthesize(request: VoiceSynthesizeRequest, context: AdapterContext): Promise<SpeechClip> {
    const signal = voiceDeadline(request.signal ?? context.signal, SPEAK_DEADLINE_MS);
    const res = await this.fetcher(SPEECH_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${request.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: OPENROUTER_TTS_MODEL,
        input: request.text,
        voice: openRouterVoiceId(request.voiceId),
        response_format: "pcm",
      }),
      redirect: "error",
      signal,
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw failure(res.status, "speaking");
    }
    if ((res.headers.get("content-type") ?? "").includes("json")) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error("Voice did not return audio.");
    }
    const providerRequestId = res.headers.get("x-generation-id") ?? undefined;
    return {
      bytes: pcmToWav(await readVoiceAudio(res, signal)),
      mimeType: "audio/wav",
      ...(providerRequestId ? { providerRequestId } : {}),
    };
  }

  async transcribe(
    request: VoiceTranscribeRequest,
    context: AdapterContext,
  ): Promise<VoiceTranscribeResult> {
    const res = await this.fetcher(TRANSCRIPTION_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${request.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: OPENROUTER_STT_MODEL,
        input_audio: {
          data: Buffer.from(request.audio).toString("base64"),
          format: speechUploadName(request.mimeType).split(".")[1],
        },
        // No language hint: the app's language is not the one people speak, and Whisper forced
        // into English turns Portuguese into English-sounding nonsense. It hears the language.
        response_format: "verbose_json",
      }),
      redirect: "error",
      signal: voiceDeadline(request.signal ?? context.signal, TRANSCRIBE_DEADLINE_MS),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw failure(res.status, "transcribing");
    }
    const body = (await readVoiceJson(res, { requireValid: true })) as {
      text?: unknown;
      language?: unknown;
      usage?: { cost?: unknown };
    } | null;
    if (typeof body?.text !== "string") throw new Error("Voice did not return a transcript.");
    const cost = body.usage?.cost;
    const language = heardLanguage(body.language);
    return {
      text: body.text.trim(),
      ...(language ? { language } : {}),
      ...(typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? { costUsd: cost } : {}),
    };
  }
}
