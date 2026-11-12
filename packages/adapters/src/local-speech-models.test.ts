import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_SPEECH_MODELS,
  LocalModelStore,
  type LocalSpeechModelSpec,
} from "./local-speech-models.js";

const archive = new TextEncoder().encode("not a real archive, only bytes to hash".repeat(200));
const spec: LocalSpeechModelSpec = {
  id: "test-model",
  kind: "listen",
  label: "Test",
  license: "MIT",
  sizeBytes: archive.byteLength,
  sha256: createHash("sha256").update(archive).digest("hex"),
  url: "https://models.example.test/test-model.tar.bz2",
  languages: ["en", "pt"],
  keep: ["test-encoder.int8.onnx", "test-decoder.int8.onnx", "test-tokens.txt"],
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "speech-models-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A fetch that serves the fake archive in chunks, counting how often it was asked. */
function servingFetch(bytes: Uint8Array = archive) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const chunks = [bytes.slice(0, 1000), bytes.slice(1000)];
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
      { headers: { "content-length": String(bytes.byteLength) } },
    );
  });
}

/** Stands in for tar: writes the files the spec says to keep. */
const fakeExtract = vi.fn(
  async (_archive: string, destination: string, keep: readonly string[]) => {
    await mkdir(destination, { recursive: true });
    for (const name of keep) await writeFile(path.join(destination, name), name);
  },
);

function store(fetchImpl: ReturnType<typeof servingFetch>, over: { stallMs?: number } = {}) {
  return new LocalModelStore({
    dir,
    fetch: fetchImpl as unknown as typeof fetch,
    extract: fakeExtract,
    models: [spec],
    ...over,
  });
}

describe("LocalModelStore", () => {
  it("ensure downloads, verifies the digest and returns the model directory", async () => {
    const fetchImpl = servingFetch();
    const modelDir = await store(fetchImpl).ensure(spec.id);
    expect(modelDir).toBe(path.join(dir, spec.id));
    expect((await readdir(modelDir)).sort()).toEqual([...spec.keep, ".ready"].sort());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(spec.url);
    const [info] = await store(fetchImpl).list();
    expect(info).toMatchObject({ id: spec.id, state: "ready", bytesDone: spec.sizeBytes });
  });

  it("a digest mismatch fails and leaves nothing behind", async () => {
    const wrong = new Uint8Array(archive.byteLength).fill(7);
    await expect(store(servingFetch(wrong)).ensure(spec.id)).rejects.toThrow(/digest/i);
    expect(await readdir(dir).then((names) => names.filter((n) => !n.startsWith(".")))).toEqual([]);
    const partial = await readdir(path.join(dir, ".partial")).catch(() => []);
    expect(partial).toEqual([]);
    const [info] = await store(servingFetch()).list();
    expect(info).toMatchObject({ state: "failed" });
    expect(info?.error).toMatch(/digest/i);
  });

  it("two ensure calls for one model make one request and both resolve", async () => {
    const fetchImpl = servingFetch();
    const one = store(fetchImpl);
    const [a, b] = await Promise.all([one.ensure(spec.id), one.ensure(spec.id)]);
    expect(a).toBe(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a second process waits for the running download instead of downloading again", async () => {
    const fetchImpl = servingFetch();
    const first = store(fetchImpl);
    const second = store(fetchImpl);
    const [a, b] = await Promise.all([first.ensure(spec.id), second.ensure(spec.id)]);
    expect(a).toBe(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a partial file left by a crash is discarded and never reported ready", async () => {
    await mkdir(path.join(dir, ".partial"), { recursive: true });
    await mkdir(path.join(dir, ".state"), { recursive: true });
    await writeFile(path.join(dir, ".partial", `${spec.id}.tar.bz2`), "half a download");
    await writeFile(
      path.join(dir, ".state", `${spec.id}.json`),
      JSON.stringify({ state: "downloading", bytesDone: 15, updatedAt: Date.now() - 3_600_000 }),
    );
    // A crashed download also leaves a lock behind; it is old, so it is not a live one.
    const lock = path.join(dir, ".state", `${spec.id}.lock`);
    await writeFile(lock, "999999");
    const old = new Date(Date.now() - 3_600_000);
    await utimes(lock, old, old);

    const fetchImpl = servingFetch();
    const fresh = store(fetchImpl);
    expect((await fresh.list())[0]).toMatchObject({ state: "absent", bytesDone: 0 });
    await fresh.ensure(spec.id);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await fresh.list())[0]?.state).toBe("ready");
  });

  it("no progress for stallMs fails the download with a clear error", async () => {
    const stalling = vi.fn(async () => {
      let sent = false;
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (!sent) {
              sent = true;
              controller.enqueue(archive.slice(0, 10));
              return undefined;
            }
            return new Promise(() => undefined);
          },
        }),
      );
    });
    await expect(
      store(stalling as unknown as ReturnType<typeof servingFetch>, { stallMs: 50 }).ensure(
        spec.id,
      ),
    ).rejects.toThrow(/stalled/i);
    expect((await store(servingFetch()).list())[0]?.state).toBe("failed");
  });

  it("cancel stops a running download and reports the model absent", async () => {
    const slow = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      return new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(archive.slice(0, 10));
            return new Promise((resolve) => setTimeout(resolve, 20));
          },
          cancel() {
            void init;
          },
        }),
      );
    });
    const target = store(slow as unknown as ReturnType<typeof servingFetch>);
    const running = target.ensure(spec.id);
    const settled = running.then(
      () => "resolved",
      (error: Error) => error.message,
    );
    await vi.waitFor(async () => expect((await target.list())[0]?.state).toBe("downloading"));
    target.cancel(spec.id);
    expect(await settled).toMatch(/cancel/i);
    expect((await target.list())[0]).toMatchObject({ state: "absent", bytesDone: 0 });
  });

  it("remove deletes the model and ensure then downloads it again", async () => {
    const fetchImpl = servingFetch();
    const target = store(fetchImpl);
    await target.ensure(spec.id);
    await target.remove(spec.id);
    await expect(stat(path.join(dir, spec.id))).rejects.toThrow();
    expect((await target.list())[0]?.state).toBe("absent");
    await target.ensure(spec.id);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("allows automatic downloads until a model is removed or a download cancelled, and again once the owner asks", async () => {
    const target = store(servingFetch());
    expect(await target.automaticDownloadAllowed()).toBe(true);
    await target.ensure(spec.id);
    await target.remove(spec.id);
    expect(await target.automaticDownloadAllowed()).toBe(false);
    // A new process reads the same answer from disk.
    expect(await store(servingFetch()).automaticDownloadAllowed()).toBe(false);
    await target.allowAutomaticDownload();
    expect(await target.automaticDownloadAllowed()).toBe(true);
    target.cancel(spec.id);
    await vi.waitFor(async () => expect(await target.automaticDownloadAllowed()).toBe(false));
  });

  it("keeps the opt-out of listening models and of voices apart", async () => {
    const voice: LocalSpeechModelSpec = { ...spec, id: "test-voice", kind: "speak" };
    const target = new LocalModelStore({
      dir,
      fetch: servingFetch() as unknown as typeof fetch,
      extract: fakeExtract,
      models: [spec, voice],
    });
    await target.ensure(voice.id);
    await target.remove(voice.id);
    expect(await target.automaticDownloadAllowed("speak")).toBe(false);
    // Removing a voice must not stop the listening model from coming by itself.
    expect(await target.automaticDownloadAllowed("listen")).toBe(true);
    await target.allowAutomaticDownload("speak");
    expect(await target.automaticDownloadAllowed("speak")).toBe(true);
  });

  it("lists a model's kind and, for a voice, a sample to play", async () => {
    const voice: LocalSpeechModelSpec = { ...spec, id: "test-voice", kind: "speak", sample: "Hi" };
    const target = new LocalModelStore({ dir, models: [spec, voice] });
    expect(await target.list()).toMatchObject([
      { id: "test-model", kind: "listen" },
      { id: "test-voice", kind: "speak", sample: "Hi" },
    ]);
    expect(target.specs("speak").map((entry) => entry.id)).toEqual(["test-voice"]);
    expect(target.spec("test-model")?.license).toBe("MIT");
  });

  it("a model that is not in the catalog is never fetched", async () => {
    const fetchImpl = servingFetch();
    await expect(store(fetchImpl).ensure("https://evil.example.test/x")).rejects.toThrow(
      /unknown/i,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("the shipped catalog uses one fixed https origin and pinned digests", () => {
    expect(LOCAL_SPEECH_MODELS.map((model) => model.id)).toEqual(["base", "small"]);
    for (const model of LOCAL_SPEECH_MODELS) {
      expect(model.kind).toBe("listen");
      expect(model.url.startsWith("https://github.com/k2-fsa/sherpa-onnx/releases/download/")).toBe(
        true,
      );
      expect(model.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(model.keep.some((name) => name.endsWith("-tokens.txt"))).toBe(true);
    }
  });
});
