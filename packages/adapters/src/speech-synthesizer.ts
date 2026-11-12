import type { LocalVoiceEngine } from "./local-speech-models.js";

export interface SpeechSynthesizeInput {
  text: string;
  /** The directory `LocalModelStore.ensure` returned for the voice. */
  modelDir: string;
  voice: LocalVoiceEngine;
  signal?: AbortSignal | undefined;
}

/** Mono samples in -1..1. */
export interface SynthesizedSpeech {
  samples: Float32Array;
  sampleRate: number;
}

/** The speech engine behind the local voice provider. Only one adapter file knows the engine. */
export interface SpeechSynthesizer {
  synthesize(input: SpeechSynthesizeInput): Promise<SynthesizedSpeech>;
}

/** Deterministic stand-in for tests: answers from a function and records what it was asked. */
export class ScriptedSynthesizer implements SpeechSynthesizer {
  readonly calls: SpeechSynthesizeInput[] = [];

  constructor(
    private readonly respond: (
      input: SpeechSynthesizeInput,
    ) => SynthesizedSpeech | Promise<SynthesizedSpeech> = () => ({
      samples: new Float32Array(2205).fill(0.1),
      sampleRate: 22050,
    }),
  ) {}

  async synthesize(input: SpeechSynthesizeInput): Promise<SynthesizedSpeech> {
    this.calls.push(input);
    return this.respond(input);
  }
}

/** 16-bit PCM mono WAV, which every browser plays. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const clipped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, Math.round(clipped * 32767), true);
  }
  return bytes;
}
