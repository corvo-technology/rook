import { createRequire } from "node:module";
import type { VoiceTranscribeResult } from "@corvo/adapter-kit";
import {
  childScript,
  type SpeechChild,
  SpeechProcess,
  type SpeechProcessOptions,
  spawnNodeChild,
} from "./speech-process.js";
import type { SpeechTranscribeInput, SpeechTranscriber } from "./speech-transcriber.js";

/**
 * The only file that knows the sherpa-onnx engine. The recognizer runs in a child process (see
 * `speech-process.ts`) so a crash of the native engine fails the clip in flight and nothing
 * else, and the process is ended when idle so the model's memory (a few hundred MB) is given back.
 *
 * The engine is told the samples directly. It is never asked for a native buffer (for example by
 * `readWave`), because Electron forbids them.
 *
 * The child is inline source rather than a separate file so a bundled app has nothing to locate;
 * it receives the engine's resolved path instead of resolving it from the current directory.
 */
const HANDLER = `
const path = require("node:path");
let cached;
function recognizerFor(modelDir, language) {
  const key = modelDir + "|" + language;
  if (cached && cached.key === key) return cached.recognizer;
  const name = path.basename(modelDir);
  cached = undefined;
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      whisper: {
        encoder: path.join(modelDir, name + "-encoder.int8.onnx"),
        decoder: path.join(modelDir, name + "-decoder.int8.onnx"),
        language,
        task: "transcribe",
        tailPaddings: -1,
      },
      tokens: path.join(modelDir, name + "-tokens.txt"),
      numThreads,
      provider: "cpu",
      debug: 0,
    },
  });
  cached = { key, recognizer };
  return recognizer;
}
function handle(job) {
  const recognizer = recognizerFor(job.modelDir, job.language);
  if (job.type === "warm") return {};
  const stream = recognizer.createStream();
  stream.acceptWaveform({ sampleRate: 16000, samples: job.samples });
  recognizer.decode(stream);
  const result = recognizer.getResult(stream);
  return { text: String(result.text || "").trim(), language: result.lang || undefined };
}
`;

export interface SherpaWhisperOptions {
  /** CPU threads for decoding. */
  numThreads?: number;
  /** How long the process (and the model in memory) is kept after the last clip. */
  idleMs?: number;
  /** Ends a clip that takes longer than this, loading the model included. */
  timeoutMs?: number;
  /** Starts the engine's process; replaced in tests. */
  spawn?: () => SpeechChild;
  backoffMs?: SpeechProcessOptions["backoffMs"];
}

type Done = { text?: string; language?: string };

export class SherpaWhisperTranscriber implements SpeechTranscriber {
  private readonly process: SpeechProcess<Done>;

  constructor(options: SherpaWhisperOptions = {}) {
    const numThreads = options.numThreads ?? 4;
    this.process = new SpeechProcess<Done>({
      name: "Transcription",
      spawn:
        options.spawn ??
        (() =>
          spawnNodeChild(childScript(HANDLER), {
            CORVO_SPEECH_ENGINE: createRequire(import.meta.url).resolve("sherpa-onnx-node"),
            CORVO_SPEECH_THREADS: String(numThreads),
          })),
      timeoutMs: options.timeoutMs ?? 120_000,
      idleMs: options.idleMs ?? 60_000,
      ...(options.backoffMs ? { backoffMs: options.backoffMs } : {}),
    });
  }

  async transcribe(input: SpeechTranscribeInput): Promise<VoiceTranscribeResult> {
    const done = await this.process.request(
      {
        type: "transcribe",
        modelDir: input.modelDir,
        language: input.language ?? "",
        samples: new Float32Array(input.pcm),
      },
      input.signal,
    );
    return {
      text: done.text ?? "",
      ...(done.language ? { language: done.language } : {}),
    };
  }

  /** Loads the model so the first recording does not wait for it. */
  async warm(input: { modelDir: string; language?: string; signal?: AbortSignal }): Promise<void> {
    await this.process.request(
      { type: "warm", modelDir: input.modelDir, language: input.language ?? "" },
      input.signal,
    );
  }

  async close(): Promise<void> {
    await this.process.close();
  }
}
