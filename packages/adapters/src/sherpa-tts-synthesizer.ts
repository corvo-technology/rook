import { createRequire } from "node:module";
import {
  childScript,
  type SpeechChild,
  SpeechProcess,
  type SpeechProcessOptions,
  spawnNodeChild,
} from "./speech-process.js";
import type {
  SpeechSynthesizeInput,
  SpeechSynthesizer,
  SynthesizedSpeech,
} from "./speech-synthesizer.js";

/**
 * The only file that knows the sherpa-onnx speech engine. The engine is native code that can
 * crash on some inputs, so the voice runs in a child process (see `speech-process.ts`): a crash
 * fails the sentence in flight and the next one starts a fresh process. The voice stays loaded
 * between sentences and is given back after a while idle; a conversation speaks again within
 * seconds, so it is kept longer than a transcription model.
 *
 * The engine is asked for plain arrays, never a native buffer: Electron forbids them.
 */
const HANDLER = `
const path = require("node:path");
let cached;
function engineFor(modelDir, voice) {
  if (cached && cached.key === modelDir) return cached.tts;
  const at = (name) => path.join(modelDir, name);
  const model =
    voice.type === "kokoro"
      ? { kokoro: { model: at(voice.model), voices: at(voice.voices), tokens: at(voice.tokens), lexicon: at(voice.lexicon) } }
      : { vits: { model: at(voice.model), tokens: at(voice.tokens), ...(voice.lexicon ? { lexicon: at(voice.lexicon) } : {}) } };
  cached = undefined;
  const tts = new sherpa.OfflineTts({
    model: { ...model, numThreads, provider: "cpu", debug: 0 },
    maxNumSentences: 1,
  });
  cached = { key: modelDir, tts };
  return tts;
}
function handle(job) {
  const tts = engineFor(job.modelDir, job.voice);
  if (job.type === "warm") return {};
  const audio = tts.generate({
    text: job.text,
    sid: job.voice.type === "kokoro" ? job.voice.speakerId : 0,
    speed: 1,
    enableExternalBuffer: false,
  });
  if (!audio.samples || audio.samples.length === 0) throw new Error("The voice made no sound.");
  return { samples: new Float32Array(audio.samples), sampleRate: audio.sampleRate };
}
`;

export interface SherpaTtsOptions {
  /** CPU threads for synthesis. */
  numThreads?: number;
  /** How long the process (and the voice in memory) is kept after the last sentence. */
  idleMs?: number;
  /** Ends a sentence that takes longer than this, loading the voice included. */
  timeoutMs?: number;
  /** Starts the engine's process; replaced in tests. */
  spawn?: () => SpeechChild;
  backoffMs?: SpeechProcessOptions["backoffMs"];
}

type Done = Partial<SynthesizedSpeech>;

export class SherpaTtsSynthesizer implements SpeechSynthesizer {
  private readonly process: SpeechProcess<Done>;

  constructor(options: SherpaTtsOptions = {}) {
    const numThreads = options.numThreads ?? 4;
    this.process = new SpeechProcess<Done>({
      name: "Speech",
      spawn:
        options.spawn ??
        (() =>
          spawnNodeChild(
            childScript(HANDLER),
            createRequire(import.meta.url).resolve("sherpa-onnx-node"),
            numThreads,
          )),
      timeoutMs: options.timeoutMs ?? 90_000,
      idleMs: options.idleMs ?? 180_000,
      ...(options.backoffMs ? { backoffMs: options.backoffMs } : {}),
    });
  }

  async synthesize(input: SpeechSynthesizeInput): Promise<SynthesizedSpeech> {
    const done = await this.process.request(
      { type: "speak", text: input.text, modelDir: input.modelDir, voice: input.voice },
      input.signal,
    );
    if (!done.samples || !done.sampleRate) throw new Error("Speech failed: no audio");
    return { samples: done.samples, sampleRate: done.sampleRate };
  }

  /** Loads the voice so the first sentence does not wait for it. */
  async warm(input: Pick<SpeechSynthesizeInput, "modelDir" | "voice" | "signal">): Promise<void> {
    await this.process.request(
      { type: "warm", modelDir: input.modelDir, voice: input.voice },
      input.signal,
    );
  }

  async close(): Promise<void> {
    await this.process.close();
  }
}
