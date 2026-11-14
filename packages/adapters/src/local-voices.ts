import type { LocalSpeechModelSpec } from "./local-speech-models.js";

const ORIGIN = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/";

/**
 * The voices "This computer" can speak with, from the sherpa-onnx engine project's releases.
 * Digests were computed from the archives and are checked on every download.
 *
 * Most voices need no phonemizer: the character-based Coqui voices (BSD-3-Clause), the
 * lexicon-based VITS English voice (MIT, trained on the public-domain LJSpeech) and Kokoro's
 * English lexicon (Apache-2.0). The Brazilian Portuguese voice is a Piper voice, which needs the
 * espeak-ng phonemizer (GPL-3.0); it runs in an engine process of its own, apart from the app.
 *
 * The license of each is listed in THIRD_PARTY_NOTICES.md.
 */
export const LOCAL_VOICES: readonly LocalSpeechModelSpec[] = [
  {
    id: "voice-pt",
    kind: "speak",
    label: "Português (Brasil)",
    license: "MIT",
    sizeBytes: 67_183_065,
    sha256: "7add3f923ad6bc25ca8a192805fd1a64d1b3893e4611c4a9719545a825039a83",
    url: `${ORIGIN}vits-piper-pt_BR-faber-medium.tar.bz2`,
    languages: ["pt"],
    keep: ["pt_BR-faber-medium.onnx", "tokens.txt", "espeak-ng-data"],
    voice: {
      type: "piper",
      model: "pt_BR-faber-medium.onnx",
      tokens: "tokens.txt",
      dataDir: "espeak-ng-data",
    },
    sample: "Olá, eu sou a sua voz neste computador.",
  },
  {
    id: "voice-es",
    kind: "speak",
    label: "Español",
    license: "BSD-3-Clause",
    sizeBytes: 67_086_376,
    sha256: "00a725c3611c5510cade535dbb8e5a1bde81b032d085b77972eb80b1d240cd1e",
    url: `${ORIGIN}vits-coqui-es-css10.tar.bz2`,
    languages: ["es"],
    keep: ["model.onnx", "tokens.txt"],
    voice: { type: "vits", model: "model.onnx", tokens: "tokens.txt" },
    sample: "Hola, soy tu voz en este ordenador.",
  },
  {
    id: "voice-fr",
    kind: "speak",
    label: "Français",
    license: "BSD-3-Clause",
    sizeBytes: 67_044_087,
    sha256: "a11143ec2420583466bada28e194494134900761dc4147ac9305857754976699",
    url: `${ORIGIN}vits-coqui-fr-css10.tar.bz2`,
    languages: ["fr"],
    keep: ["model.onnx", "tokens.txt"],
    voice: { type: "vits", model: "model.onnx", tokens: "tokens.txt" },
    sample: "Bonjour, je suis votre voix sur cet ordinateur.",
  },
  {
    id: "voice-de",
    kind: "speak",
    label: "Deutsch",
    license: "BSD-3-Clause",
    sizeBytes: 67_104_896,
    sha256: "9ead46b1d4fcc99285e4883dafd4808c1983eb234b35f9b22502d105bf9f6594",
    url: `${ORIGIN}vits-coqui-de-css10.tar.bz2`,
    languages: ["de"],
    keep: ["model.onnx", "tokens.txt"],
    voice: { type: "vits", model: "model.onnx", tokens: "tokens.txt" },
    sample: "Hallo, ich bin Ihre Stimme auf diesem Computer.",
  },
  {
    id: "voice-ljs",
    kind: "speak",
    label: "English",
    license: "MIT",
    sizeBytes: 109_037_061,
    sha256: "78f7df445fcd42d1dd6df2c78c66c2c2fee8b7abecc6ae255a5950097a6558bc",
    url: `${ORIGIN}vits-ljs.tar.bz2`,
    languages: ["en"],
    keep: ["vits-ljs.onnx", "tokens.txt", "lexicon.txt", "README.md"],
    voice: {
      type: "vits",
      model: "vits-ljs.onnx",
      tokens: "tokens.txt",
      lexicon: "lexicon.txt",
    },
    sample: "Hello, I am your voice on this computer.",
  },
  {
    id: "voice-kokoro",
    kind: "speak",
    label: "Kokoro (English, more natural)",
    license: "Apache-2.0",
    sizeBytes: 132_353_410,
    sha256: "72c347230107ef8a31098ec4d468a605244beef5f1ed00db97efa13518800653",
    url: `${ORIGIN}kokoro-int8-multi-lang-v1_0.tar.bz2`,
    languages: ["en"],
    keep: ["model.int8.onnx", "voices.bin", "tokens.txt", "lexicon-us-en.txt", "LICENSE"],
    voice: {
      type: "kokoro",
      model: "model.int8.onnx",
      voices: "voices.bin",
      tokens: "tokens.txt",
      lexicon: "lexicon-us-en.txt",
      // af_heart
      speakerId: 3,
    },
    sample: "Hello, I am your voice on this computer.",
  },
];

/** The listening model downloaded for the first recording when the owner has chosen none. */
export const DEFAULT_LOCAL_MODEL = "base";

/** The voice downloaded when the owner has chosen none, and the one that reads any other language. */
export const DEFAULT_LOCAL_VOICE = "voice-ljs";

/** The primary language subtag: "pt-BR" and "PT_br" are both "pt". */
export function primaryLanguage(tag: string | undefined): string | undefined {
  const primary = tag?.split(/[-_]/)[0]?.trim().toLowerCase();
  return primary || undefined;
}

/**
 * The voice that reads a reply in `language`. A voice that is on this computer and speaks the
 * language wins, the owner's own choice first. Without one the owner's choice, or any voice on
 * this computer, reads it instead. With no voice downloaded the language's own is named, so it
 * can be fetched, and any other language gets the default.
 */
export function chooseLocalVoice(input: {
  language?: string | undefined;
  /** The voice the owner picked, if any. */
  selected?: string | undefined;
  /** The voices that are on this computer. */
  ready: readonly string[];
  voices?: readonly LocalSpeechModelSpec[];
}): string {
  const voices = input.voices ?? LOCAL_VOICES;
  const language = primaryLanguage(input.language);
  const speaking = (voice: LocalSpeechModelSpec) =>
    language !== undefined && voice.languages.includes(language);
  const local = voices.filter((voice) => input.ready.includes(voice.id));
  const picked = local.find((voice) => voice.id === input.selected);
  if (picked && (language === undefined || speaking(picked))) return picked.id;
  const match = local.find(speaking);
  if (match) return match.id;
  const anyReady = picked ?? local[0];
  if (anyReady) return anyReady.id;
  return voices.find(speaking)?.id ?? DEFAULT_LOCAL_VOICE;
}
