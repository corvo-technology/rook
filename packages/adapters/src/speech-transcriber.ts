import type { VoiceTranscribeResult } from "@corvo/adapter-kit";

export interface SpeechTranscribeInput {
  /** Mono samples in -1..1 at 16 kHz. */
  pcm: Float32Array;
  sampleRate: 16000;
  /** ISO 639-1 code; undefined lets the model detect the language. */
  language?: string | undefined;
  /** The directory `LocalModelStore.ensure` returned. */
  modelDir: string;
  signal?: AbortSignal | undefined;
}

/** The speech engine behind the local voice provider. Only one adapter file knows the engine. */
export interface SpeechTranscriber {
  transcribe(input: SpeechTranscribeInput): Promise<VoiceTranscribeResult>;
  /** Loads the model ahead of the first recording. Optional: an engine with nothing to load skips it. */
  warm?(input: { modelDir: string; language?: string; signal?: AbortSignal }): Promise<void>;
}

/** Deterministic stand-in for tests: answers from a function and records what it was asked. */
export class ScriptedTranscriber implements SpeechTranscriber {
  readonly calls: SpeechTranscribeInput[] = [];

  constructor(
    private readonly respond: (
      input: SpeechTranscribeInput,
    ) => VoiceTranscribeResult | Promise<VoiceTranscribeResult> = () => ({
      text: "scripted transcript",
      language: "en",
    }),
  ) {}

  async transcribe(input: SpeechTranscribeInput): Promise<VoiceTranscribeResult> {
    this.calls.push(input);
    return this.respond(input);
  }
}
