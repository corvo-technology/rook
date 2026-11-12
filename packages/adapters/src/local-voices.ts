import type { LocalSpeechModelSpec } from "./local-speech-models.js";

const ORIGIN = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/";

/**
 * The voices "This computer" can speak with, from the sherpa-onnx engine project's releases.
 * Digests were computed from the archives and are checked on every download.
 *
 * Only models the engine can speak without a phonemizer are listed. sherpa-onnx 2.x dropped the
 * GPL-3.0 espeak-ng phonemizer that Piper voices need, so Piper voices are not offered; the
 * character-based Coqui voices (BSD-3-Clause) and Kokoro's English lexicon (Apache-2.0) are.
 *
 * Every voice here allows use and redistribution in a product; the license of each is listed
 * in THIRD_PARTY_NOTICES.md.
 */
export const LOCAL_VOICES: readonly LocalSpeechModelSpec[] = [
  {
    id: "voice-pt",
    kind: "speak",
    label: "Português (Brasil)",
    license: "BSD-3-Clause",
    sizeBytes: 67_043_814,
    sha256: "f057e8d94e4f84813da498b27b955dbe094fd68c5cbda1b1a2d058231a6f1b48",
    url: `${ORIGIN}vits-coqui-pt-cv.tar.bz2`,
    languages: ["pt"],
    keep: ["model.onnx", "tokens.txt"],
    voice: { type: "vits", model: "model.onnx", tokens: "tokens.txt" },
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
    id: "voice-kokoro",
    kind: "speak",
    label: "Kokoro (English)",
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
export const DEFAULT_LOCAL_VOICE = "voice-kokoro";

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
