import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import type {
  SpeechSynthesizeInput,
  SpeechSynthesizer,
  SynthesizedSpeech,
} from "./speech-synthesizer.js";

/**
 * The only file that knows the sherpa-onnx speech engine. Like the transcriber, the voice runs in
 * a worker thread so synthesis never blocks the engine's event loop, and the worker is ended
 * when idle so the voice's memory is given back. A conversation speaks again within seconds, so
 * the voice is kept longer than a transcription model.
 *
 * The engine is asked for plain arrays, never a native buffer: Electron forbids them.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const path = require("node:path");
const sherpa = require(workerData.engine);
let cached;
function engineFor(modelDir, voice) {
  if (cached && cached.key === modelDir) return cached.tts;
  const at = (name) => path.join(modelDir, name);
  const model =
    voice.type === "kokoro"
      ? { kokoro: { model: at(voice.model), voices: at(voice.voices), tokens: at(voice.tokens), lexicon: at(voice.lexicon) } }
      : { vits: { model: at(voice.model), tokens: at(voice.tokens) } };
  const tts = new sherpa.OfflineTts({
    model: { ...model, numThreads: workerData.numThreads, provider: "cpu", debug: 0 },
    maxNumSentences: 1,
  });
  cached = { key: modelDir, tts };
  return tts;
}
parentPort.on("message", (job) => {
  try {
    const tts = engineFor(job.modelDir, job.voice);
    const audio = tts.generate({
      text: job.text,
      sid: job.voice.type === "kokoro" ? job.voice.speakerId : 0,
      speed: 1,
      enableExternalBuffer: false,
    });
    if (!audio.samples || audio.samples.length === 0) throw new Error("The voice made no sound.");
    const samples = new Float32Array(audio.samples);
    parentPort.postMessage({ id: job.id, samples, sampleRate: audio.sampleRate }, [samples.buffer]);
  } catch (error) {
    parentPort.postMessage({ id: job.id, error: error && error.message ? error.message : String(error) });
  }
});
`;

export interface SherpaTtsOptions {
  /** CPU threads for synthesis. */
  numThreads?: number;
  /** How long the worker (and the voice in memory) is kept after the last sentence. */
  idleMs?: number;
}

type Reply = { id: number; samples?: Float32Array; sampleRate?: number; error?: string };

export class SherpaTtsSynthesizer implements SpeechSynthesizer {
  private worker: Worker | undefined;
  private idleTimer: NodeJS.Timeout | undefined;
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly numThreads: number;
  private readonly idleMs: number;

  constructor(options: SherpaTtsOptions = {}) {
    this.numThreads = options.numThreads ?? 4;
    this.idleMs = options.idleMs ?? 180_000;
  }

  /** One sentence at a time, in the order asked: the voice and the CPU are shared. */
  synthesize(input: SpeechSynthesizeInput): Promise<SynthesizedSpeech> {
    const run = this.queue.then(() => this.runOne(input));
    this.queue = run.catch(() => undefined);
    return run;
  }

  async close(): Promise<void> {
    clearTimeout(this.idleTimer);
    await this.stopWorker();
  }

  private start(): Worker {
    if (this.worker) return this.worker;
    const engine = createRequire(import.meta.url).resolve("sherpa-onnx-node");
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { engine, numThreads: this.numThreads },
    });
    this.worker = worker;
    worker.once("exit", () => {
      if (this.worker === worker) this.worker = undefined;
    });
    return worker;
  }

  private async stopWorker() {
    const worker = this.worker;
    this.worker = undefined;
    await worker?.terminate();
  }

  private runOne(input: SpeechSynthesizeInput): Promise<SynthesizedSpeech> {
    clearTimeout(this.idleTimer);
    if (input.signal?.aborted) return Promise.reject(new Error("Speech cancelled."));
    const worker = this.start();
    const id = this.nextId++;
    return new Promise<SynthesizedSpeech>((resolve, reject) => {
      const cleanup = () => {
        worker.off("message", onMessage);
        worker.off("error", onError);
        input.signal?.removeEventListener("abort", onAbort);
        this.idleTimer = setTimeout(() => void this.stopWorker(), this.idleMs);
        this.idleTimer.unref();
      };
      const onMessage = (reply: Reply) => {
        if (reply.id !== id) return;
        cleanup();
        if (reply.error || !reply.samples || !reply.sampleRate) {
          reject(new Error(`Speech failed: ${reply.error ?? "no audio"}`));
        } else resolve({ samples: reply.samples, sampleRate: reply.sampleRate });
      };
      const onError = (error: Error) => {
        cleanup();
        void this.stopWorker();
        reject(error);
      };
      const onAbort = () => {
        cleanup();
        void this.stopWorker();
        reject(new Error("Speech cancelled."));
      };
      worker.on("message", onMessage);
      worker.on("error", onError);
      input.signal?.addEventListener("abort", onAbort, { once: true });
      worker.postMessage({
        id,
        text: input.text,
        modelDir: input.modelDir,
        voice: input.voice,
      });
    });
  }
}
