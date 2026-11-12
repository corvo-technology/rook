import { spawn } from "node:child_process";
import { mkdir, open, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LocalSpeechModel } from "@corvo/contracts";
import { LOCAL_VOICES } from "./local-voices.js";
import { downloadVerified } from "./verified-download.js";

const ORIGIN = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/";

/** How the engine speaks a voice. Paths are relative to the voice's directory. */
export type LocalVoiceEngine =
  | { type: "vits"; model: string; tokens: string; lexicon?: string }
  | {
      type: "kokoro";
      model: string;
      voices: string;
      tokens: string;
      lexicon: string;
      /** Which of the model's many speakers this voice is. */
      speakerId: number;
    };

/**
 * A model the local provider can download: one that listens, or a voice that speaks.
 * `sizeBytes` is the archive's size.
 */
export interface LocalSpeechModelSpec {
  id: string;
  kind: "listen" | "speak";
  label: string;
  /** The model's license, as its authors state it; also listed in THIRD_PARTY_NOTICES.md. */
  license: string;
  sizeBytes: number;
  sha256: string;
  url: string;
  languages: readonly string[];
  /** The files kept from the archive; it also holds fp32 copies the engine does not need. */
  keep: readonly string[];
  /** Voices only. */
  voice?: LocalVoiceEngine;
  /** Voices only: a line the owner can hear before choosing the voice, in the voice's language. */
  sample?: string;
}

/** The languages "This computer" is told about; Whisper itself understands many more. */
const WHISPER_LANGUAGES = ["en", "pt", "es", "fr", "de", "ja", "zh"] as const;

/**
 * Whisper models for the sherpa-onnx engine, multilingual. Digests come from the engine spike
 * (docs/superpowers/specs/2026-11-05-local-transcription-engine-spike.md) and are checked on
 * every download.
 */
export const LOCAL_SPEECH_MODELS: readonly LocalSpeechModelSpec[] = [
  {
    id: "base",
    kind: "listen",
    label: "Base",
    license: "MIT",
    sizeBytes: 207_557_382,
    sha256: "911b2083efd7c0dca2ac3b358b75222660dc09fb716d64fbfc417ba6c99ff3de",
    url: `${ORIGIN}sherpa-onnx-whisper-base.tar.bz2`,
    languages: [...WHISPER_LANGUAGES],
    keep: ["base-encoder.int8.onnx", "base-decoder.int8.onnx", "base-tokens.txt"],
  },
  {
    id: "small",
    kind: "listen",
    label: "Small",
    license: "MIT",
    sizeBytes: 639_387_718,
    sha256: "486a46afbb7ba798507190ffe02fea2dd726049af212e774537efac6afb210a6",
    url: `${ORIGIN}sherpa-onnx-whisper-small.tar.bz2`,
    languages: [...WHISPER_LANGUAGES],
    keep: ["small-encoder.int8.onnx", "small-decoder.int8.onnx", "small-tokens.txt"],
  },
];

export class UnknownLocalModelError extends Error {
  constructor(id: string) {
    super(`Unknown local speech model "${id.slice(0, 80)}".`);
    this.name = "UnknownLocalModelError";
  }
}

export type ExtractArchive = (
  archive: string,
  destination: string,
  keep: readonly string[],
  root: string,
) => Promise<void>;

/** Extracts only the kept files with the system tar, dropping the archive's top directory. */
export const extractWithTar: ExtractArchive = (archive, destination, keep, root) =>
  new Promise((resolve, reject) => {
    const args = ["-xjf", archive, "-C", destination, "--strip-components=1"];
    for (const name of keep) args.push(`${root}/${name}`);
    const child = spawn("tar", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`tar failed (${code}): ${stderr.slice(0, 300)}`)),
    );
  });

export interface LocalModelStoreOptions {
  dir: string;
  fetch?: typeof fetch;
  extract?: ExtractArchive;
  models?: readonly LocalSpeechModelSpec[];
  /** A download with no data for this long counts as failed; also how old a lock may be. */
  stallMs?: number;
  /** How often a process waits on another process's download. */
  pollMs?: number;
}

type StateFile = {
  state: "downloading" | "failed";
  bytesDone: number;
  error?: string;
  updatedAt: number;
};
type Active = { promise: Promise<string>; controller: AbortController };

const PROGRESS_EVERY_MS = 300;

/**
 * Downloads speech models once, checks each against a pinned digest, and keeps only the files the
 * engine reads. The API and the worker share one directory, so a lock file stops them downloading
 * the same model twice, and a lock nobody has touched for `stallMs` belongs to a dead process.
 */
export class LocalModelStore {
  private readonly dir: string;
  private readonly fetchImpl: typeof fetch;
  private readonly extract: ExtractArchive;
  private readonly models: readonly LocalSpeechModelSpec[];
  private readonly stallMs: number;
  private readonly pollMs: number;
  private readonly active = new Map<string, Active>();
  private readonly progress = new Map<string, number>();

  constructor(options: LocalModelStoreOptions) {
    this.dir = options.dir;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.extract = options.extract ?? extractWithTar;
    this.models = options.models ?? [...LOCAL_SPEECH_MODELS, ...LOCAL_VOICES];
    this.stallMs = options.stallMs ?? 5 * 60_000;
    this.pollMs = options.pollMs ?? 250;
  }

  /** The catalog's models of one kind. */
  specs(kind: "listen" | "speak"): readonly LocalSpeechModelSpec[] {
    return this.models.filter((model) => model.kind === kind);
  }

  /** What the catalog says about a model, whether or not it is on this computer. */
  spec(id: string): LocalSpeechModelSpec | undefined {
    return this.models.find((model) => model.id === id);
  }

  async list(): Promise<LocalSpeechModel[]> {
    return Promise.all(this.models.map((spec) => this.describe(spec)));
  }

  /** Resolves to the model directory, downloading the model first when it is absent. */
  ensure(id: string, options: { signal?: AbortSignal } = {}): Promise<string> {
    const spec = this.models.find((model) => model.id === id);
    if (!spec) return Promise.reject(new UnknownLocalModelError(id));
    const running = this.active.get(id);
    if (running) return running.promise;
    const controller = new AbortController();
    options.signal?.addEventListener("abort", () => controller.abort(), { once: true });
    const promise = this.run(spec, controller).finally(() => {
      this.active.delete(id);
      this.progress.delete(id);
    });
    this.active.set(id, { promise, controller });
    return promise;
  }

  /**
   * False once the owner removed a model or cancelled a download: the next audio must not fetch a
   * model on its own again. Asking for a download clears it. Listening models and voices are
   * kept apart, so removing a voice does not stop the listening model from coming by itself.
   */
  async automaticDownloadAllowed(kind: "listen" | "speak" = "listen"): Promise<boolean> {
    return !(await this.exists(this.optOutFile(kind)));
  }

  async allowAutomaticDownload(kind: "listen" | "speak" = "listen"): Promise<void> {
    await rm(this.optOutFile(kind), { force: true });
  }

  private async stopAutomaticDownload(kind: "listen" | "speak"): Promise<void> {
    await mkdir(path.dirname(this.optOutFile(kind)), { recursive: true });
    await writeFile(this.optOutFile(kind), "");
  }

  cancel(id: string): void {
    const spec = this.models.find((model) => model.id === id);
    if (spec) void this.stopAutomaticDownload(spec.kind).catch(() => undefined);
    this.active.get(id)?.controller.abort();
    // Another process may hold the download; it looks for this marker as it makes progress.
    void writeFile(this.cancelFile(id), "").catch(() => undefined);
  }

  async remove(id: string): Promise<void> {
    const spec = this.models.find((model) => model.id === id);
    if (!spec) throw new UnknownLocalModelError(id);
    const running = this.active.get(id);
    if (running) {
      running.controller.abort();
      await running.promise.catch(() => undefined);
    }
    await rm(this.modelDir(id), { recursive: true, force: true });
    await this.clearDownload(id);
    await this.stopAutomaticDownload(spec.kind);
  }

  private modelDir(id: string) {
    return path.join(this.dir, id);
  }
  private statePath(id: string) {
    return path.join(this.dir, ".state", `${id}.json`);
  }
  private lockFile(id: string) {
    return path.join(this.dir, ".state", `${id}.lock`);
  }
  private optOutFile(kind: "listen" | "speak") {
    return path.join(
      this.dir,
      ".state",
      kind === "listen" ? "no-automatic-download" : "no-automatic-download-speak",
    );
  }
  private cancelFile(id: string) {
    return path.join(this.dir, ".state", `${id}.cancel`);
  }
  private partialFile(id: string) {
    return path.join(this.dir, ".partial", `${id}.tar.bz2`);
  }

  private async exists(file: string) {
    return stat(file).then(
      () => true,
      () => false,
    );
  }

  private async lockIsLive(id: string) {
    const info = await stat(this.lockFile(id)).catch(() => undefined);
    return info !== undefined && Date.now() - info.mtimeMs < this.stallMs;
  }

  private async describe(spec: LocalSpeechModelSpec): Promise<LocalSpeechModel> {
    const base = {
      id: spec.id,
      kind: spec.kind,
      label: spec.label,
      sizeBytes: spec.sizeBytes,
      languages: [...spec.languages],
      ...(spec.sample ? { sample: spec.sample } : {}),
    };
    if (await this.exists(path.join(this.modelDir(spec.id), ".ready"))) {
      return { ...base, state: "ready", bytesDone: spec.sizeBytes };
    }
    if (this.active.has(spec.id)) {
      return { ...base, state: "downloading", bytesDone: this.progress.get(spec.id) ?? 0 };
    }
    const saved = await readFile(this.statePath(spec.id), "utf8")
      .then((text) => JSON.parse(text) as StateFile)
      .catch(() => undefined);
    if (saved?.state === "downloading" && (await this.lockIsLive(spec.id))) {
      return { ...base, state: "downloading", bytesDone: saved.bytesDone };
    }
    if (saved?.state === "failed") {
      return { ...base, state: "failed", bytesDone: 0, error: saved.error ?? "Download failed." };
    }
    return { ...base, state: "absent", bytesDone: 0 };
  }

  private async writeState(id: string, state: StateFile) {
    await writeFile(this.statePath(id), JSON.stringify(state)).catch(() => undefined);
    await utimes(this.lockFile(id), new Date(), new Date()).catch(() => undefined);
  }

  private async clearDownload(id: string) {
    await rm(this.partialFile(id), { force: true });
    await rm(path.join(this.dir, `.extract-${id}`), { recursive: true, force: true });
    await rm(this.statePath(id), { force: true });
    await rm(this.cancelFile(id), { force: true });
  }

  /** Takes the download lock, or waits for the process that has it. Returns true when ours. */
  private async acquire(spec: LocalSpeechModelSpec, signal: AbortSignal): Promise<boolean> {
    const lock = this.lockFile(spec.id);
    for (;;) {
      if (signal.aborted) throw new Error("Download cancelled.");
      if (await this.exists(path.join(this.modelDir(spec.id), ".ready"))) return false;
      try {
        const handle = await open(lock, "wx");
        await handle.writeFile(String(process.pid));
        await handle.close();
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      if (!(await this.lockIsLive(spec.id))) {
        await rm(lock, { force: true });
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
    }
  }

  private async run(spec: LocalSpeechModelSpec, controller: AbortController): Promise<string> {
    const finalDir = this.modelDir(spec.id);
    await mkdir(path.join(this.dir, ".state"), { recursive: true });
    await mkdir(path.join(this.dir, ".partial"), { recursive: true });
    if (!(await this.acquire(spec, controller.signal))) return finalDir;
    try {
      await this.clearDownload(spec.id);
      await this.download(spec, controller);
      await this.install(spec);
      await this.clearDownload(spec.id);
      return finalDir;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = controller.signal.aborted || /cancelled/i.test(message);
      await this.clearDownload(spec.id);
      if (!cancelled)
        await this.writeState(spec.id, {
          state: "failed",
          bytesDone: 0,
          error: message,
          updatedAt: Date.now(),
        });
      throw cancelled ? new Error("Download cancelled.") : error;
    } finally {
      await rm(this.lockFile(spec.id), { force: true });
    }
  }

  private async download(spec: LocalSpeechModelSpec, controller: AbortController) {
    let lastReport = 0;
    await downloadVerified({
      url: spec.url,
      sha256: spec.sha256,
      file: this.partialFile(spec.id),
      fetch: this.fetchImpl,
      signal: controller.signal,
      stallMs: this.stallMs,
      onProgress: async (done) => {
        this.progress.set(spec.id, done);
        if (Date.now() - lastReport < PROGRESS_EVERY_MS) return;
        lastReport = Date.now();
        await this.writeState(spec.id, {
          state: "downloading",
          bytesDone: done,
          updatedAt: lastReport,
        });
        if (await this.exists(this.cancelFile(spec.id))) controller.abort();
      },
    });
  }

  private async install(spec: LocalSpeechModelSpec) {
    const extractDir = path.join(this.dir, `.extract-${spec.id}`);
    await rm(extractDir, { recursive: true, force: true });
    await mkdir(extractDir, { recursive: true });
    const root = path.basename(new URL(spec.url).pathname, ".tar.bz2");
    await this.extract(this.partialFile(spec.id), extractDir, spec.keep, root);
    for (const name of spec.keep) {
      if (!(await this.exists(path.join(extractDir, name)))) {
        throw new Error(`The archive is missing ${name}.`);
      }
    }
    await writeFile(path.join(extractDir, ".ready"), spec.sha256);
    await rm(this.modelDir(spec.id), { recursive: true, force: true });
    await rename(extractDir, this.modelDir(spec.id));
  }
}
