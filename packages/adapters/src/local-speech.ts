import path from "node:path";
import { LocalModelStore } from "./local-speech-models.js";
import { SherpaTtsSynthesizer } from "./sherpa-tts-synthesizer.js";
import { SherpaWhisperTranscriber } from "./sherpa-whisper-transcriber.js";
import type { SpeechSynthesizer } from "./speech-synthesizer.js";
import type { SpeechTranscriber } from "./speech-transcriber.js";

/** What speech on the owner's own computer needs: where models live and the engines that run them. */
export interface LocalSpeech {
  store: LocalModelStore;
  transcriber: SpeechTranscriber;
  synthesizer: SpeechSynthesizer;
}

/**
 * Only the desktop app's own engine is the owner's computer, and it alone sets the stack token.
 * A server or cloud deployment gets none, so it never offers or downloads a model.
 */
export function createLocalSpeech(env: {
  dataDir: string;
  desktopStackToken?: string | undefined;
}): LocalSpeech | undefined {
  if (!env.desktopStackToken) return undefined;
  return {
    store: new LocalModelStore({ dir: path.join(env.dataDir, "speech-models") }),
    transcriber: new SherpaWhisperTranscriber(),
    synthesizer: new SherpaTtsSynthesizer(),
  };
}
