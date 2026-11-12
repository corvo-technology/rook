import { VoiceAccountError } from "@corvo/adapter-kit";
import * as adapters from "@corvo/adapters";
import {
  LOCAL_SPEECH_MODELS,
  LOCAL_VOICES,
  LocalVoiceProvider,
  ScriptedSynthesizer,
  ScriptedTranscriber,
} from "@corvo/adapters";
import type { Actor } from "@corvo/contracts";
import * as db from "@corvo/db";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LocalModelPreparing,
  mountVoiceHttpRoutes,
  prepareVoice,
  synthesizeVoice,
  toVoiceStatus,
  transcribeVoice,
  type VoiceDeps,
  warmVoice,
} from "./voice.js";

const actor = { userId: "user-1", spaceId: "space-1" } as Actor;
const models = [...LOCAL_SPEECH_MODELS, ...LOCAL_VOICES];

type State = "ready" | "absent" | "downloading" | "failed";

/** The shipped catalog as a store lists it; `states` says what is on this computer. */
function setup(
  states: Record<string, State> = {},
  options: {
    credential?: { provider: string; secret?: string; voiceId?: string };
    automatic?: boolean;
  } = {},
) {
  const store = {
    list: vi.fn(async () =>
      models.map((model) => ({
        id: model.id,
        kind: model.kind,
        label: model.label,
        sizeBytes: model.sizeBytes,
        languages: [...model.languages],
        state: states[model.id] ?? ("absent" as State),
        bytesDone: 0,
      })),
    ),
    ensure: vi.fn(async (id: string, _options?: unknown) => `/models/${id}`),
    spec: (id: string) => models.find((model) => model.id === id),
    specs: (kind: "listen" | "speak") => models.filter((model) => model.kind === kind),
    automaticDownloadAllowed: vi.fn(async (_kind?: string) => options.automatic ?? true),
    allowAutomaticDownload: vi.fn(async () => undefined),
    cancel: vi.fn(),
    remove: vi.fn(),
  };
  const transcriber = new ScriptedTranscriber(() => ({ text: "olá", language: "pt" }));
  const synthesizer = new ScriptedSynthesizer();
  const deps = {
    prisma: { secret: { findFirst: vi.fn().mockResolvedValue({ id: "s", ciphertext: "c" }) } },
    secrets: {
      load: vi.fn().mockReturnValue(options.credential?.secret ?? "paid-key"),
      put: vi.fn(),
    },
    localSpeech: { store, transcriber, synthesizer },
  } as unknown as VoiceDeps;
  vi.spyOn(db, "findDefaultVoiceCredential").mockResolvedValue(
    options.credential
      ? ({
          id: "cred-1",
          provider: options.credential.provider,
          secretId: "s",
          voiceId: options.credential.voiceId ?? "voice-1",
          speechModel: "",
        } as never)
      : null,
  );
  return { deps, store, transcriber, synthesizer };
}

/** A paid provider that fails; the local provider is the real one over the fakes. */
function paidFails(error: unknown, deps: VoiceDeps) {
  const paid = { synthesize: vi.fn().mockRejectedValue(error) };
  vi.spyOn(adapters, "createVoiceProvider").mockImplementation(((
    kind: string,
    options?: { local?: ConstructorParameters<typeof LocalVoiceProvider>[0] },
  ) =>
    kind === "local"
      ? new LocalVoiceProvider(options?.local ?? (deps.localSpeech as never))
      : paid) as never);
  return paid;
}

beforeEach(() => {
  vi.spyOn(db, "findDefaultVoiceCredential");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("warming the voices of this computer when a call starts", () => {
  it("loads the listening model and the voice for the conversation's language", async () => {
    const { deps, synthesizer, transcriber, store } = setup({
      base: "ready",
      "voice-ljs": "ready",
    });
    const warmVoiceEngine = vi.fn(async () => undefined);
    const warmListening = vi.fn(async () => undefined);
    synthesizer.warm = warmVoiceEngine;
    transcriber.warm = warmListening;
    await warmVoice(deps, actor, { language: "en" });
    await vi.waitFor(() => expect(warmVoiceEngine).toHaveBeenCalledTimes(1));
    expect(warmVoiceEngine).toHaveBeenCalledWith(
      expect.objectContaining({ modelDir: "/models/voice-ljs" }),
    );
    expect(warmListening).toHaveBeenCalledWith({ modelDir: "/models/base" });
    expect(store.ensure).toHaveBeenCalledTimes(2);
  });

  it("downloads nothing and fails nothing when the models are not there yet", async () => {
    const { deps, synthesizer, store } = setup({});
    synthesizer.warm = vi.fn(async () => undefined);
    await warmVoice(deps, actor, { language: "en" });
    expect(synthesizer.warm).not.toHaveBeenCalled();
    expect(store.ensure).not.toHaveBeenCalled();
  });

  it("leaves a hosted voice alone", async () => {
    const { deps, synthesizer } = setup(
      { "voice-ljs": "ready" },
      { credential: { provider: "elevenlabs" } },
    );
    synthesizer.warm = vi.fn(async () => undefined);
    await warmVoice(deps, actor, { language: "en" });
    expect(synthesizer.warm).not.toHaveBeenCalled();
  });

  it("does not let a failing engine surface", async () => {
    const { deps, synthesizer } = setup({ "voice-ljs": "ready" });
    synthesizer.warm = vi.fn(async () => {
      throw new Error("engine stopped");
    });
    await expect(warmVoice(deps, actor, { language: "en" })).resolves.toBeUndefined();
  });
});

describe("toVoiceStatus with the voices of this computer", () => {
  it("is ready to listen and speak where nothing is connected but the engine is the owner's own", () => {
    expect(toVoiceStatus(null, { localDefault: true })).toEqual({
      configured: false,
      ready: true,
      transcribe: true,
      provider: null,
      voiceId: "",
    });
    expect(toVoiceStatus(null).ready).toBe(false);
  });

  it("counts a connection to this computer as ready without a voice, since voices choose themselves", () => {
    expect(toVoiceStatus({ provider: "local", voiceId: "" }).ready).toBe(true);
    expect(toVoiceStatus({ provider: "elevenlabs", voiceId: "" }).ready).toBe(false);
  });
});

describe("speaking with nothing connected", () => {
  it("speaks with the voice on this computer that fits the reply's language", async () => {
    const { deps, synthesizer } = setup({ "voice-pt": "ready", "voice-kokoro": "ready" });
    const clip = await synthesizeVoice(deps, actor, { text: "Olá!", language: "pt-BR" });
    expect(clip.mimeType).toBe("audio/wav");
    expect("fallback" in clip).toBe(false);
    expect(synthesizer.calls[0]?.modelDir).toBe("/models/voice-pt");
  });

  it("asks to connect a voice where the engine is not the owner's own", async () => {
    const { deps } = setup();
    await expect(
      synthesizeVoice({ ...deps, localSpeech: undefined }, actor, { text: "Hello" }),
    ).rejects.toThrow(/voice provider key/i);
  });

  it("speaks a sample of a voice without any connection, even over a paid one", async () => {
    const { deps, synthesizer } = setup(
      { "voice-es": "ready" },
      { credential: { provider: "elevenlabs" } },
    );
    await synthesizeVoice(deps, actor, {
      text: "Hola",
      provider: "local",
      voiceId: "voice-es",
      language: "es",
    });
    expect(synthesizer.calls[0]?.modelDir).toBe("/models/voice-es");
  });
});

describe("a paid voice that fails", () => {
  const outOfCredit = new VoiceAccountError("VOICE_OUT_OF_CREDIT", "out of credit");

  it("reads the reply with a voice already on this computer and says so", async () => {
    const { deps, synthesizer } = setup(
      { "voice-kokoro": "ready" },
      { credential: { provider: "elevenlabs" } },
    );
    paidFails(outOfCredit, deps);
    const clip = await synthesizeVoice(deps, actor, { text: "Hello there", language: "en" });
    expect(clip).toMatchObject({ mimeType: "audio/wav", fallback: true });
    expect(synthesizer.calls[0]?.modelDir).toBe("/models/voice-kokoro");
  });

  it("never downloads a voice to cover for it", async () => {
    const { deps, store } = setup({}, { credential: { provider: "elevenlabs" } });
    paidFails(outOfCredit, deps);
    await expect(synthesizeVoice(deps, actor, { text: "Hello" })).rejects.toBe(outOfCredit);
    expect(store.ensure).not.toHaveBeenCalled();
  });

  it("does not hide a cancelled request or a refused one", async () => {
    const { deps } = setup({ "voice-kokoro": "ready" }, { credential: { provider: "elevenlabs" } });
    const controller = new AbortController();
    controller.abort();
    paidFails(new Error("aborted"), deps);
    await expect(
      synthesizeVoice(deps, actor, { text: "Hello", signal: controller.signal }),
    ).rejects.toThrow("aborted");
  });

  it("does not fall back where the engine is not the owner's own", async () => {
    const { deps } = setup({}, { credential: { provider: "elevenlabs" } });
    paidFails(outOfCredit, deps);
    await expect(
      synthesizeVoice({ ...deps, localSpeech: undefined }, actor, { text: "Hello" }),
    ).rejects.toBe(outOfCredit);
  });
});

describe("preparing a spoken reply", () => {
  it("starts the download of the language's voice the first time and says how big it is", async () => {
    const { deps, store } = setup();
    const result = await prepareVoice(deps, actor, { text: "Olá, tudo bem?", language: "pt" });
    expect(result).toMatchObject({
      ready: true,
      utterances: [],
      preparing: { sizeBytes: LOCAL_VOICES.find((voice) => voice.id === "voice-pt")?.sizeBytes },
    });
    expect(store.ensure).toHaveBeenCalledWith("voice-pt");
  });

  it("does not start a second download while one runs", async () => {
    const { deps, store } = setup({ "voice-pt": "downloading" });
    const result = await prepareVoice(deps, actor, { text: "Olá", language: "pt" });
    expect(result.preparing).toBeDefined();
    expect(store.ensure).not.toHaveBeenCalled();
  });

  it("returns the sentences once the voice is on this computer", async () => {
    const { deps, store } = setup({ "voice-pt": "ready" });
    const result = await prepareVoice(deps, actor, {
      text: "Olá, tudo bem? Eu sou o seu assistente.",
      language: "pt",
    });
    expect(result.ready).toBe(true);
    expect(result).not.toHaveProperty("preparing");
    expect(result.utterances.length).toBeGreaterThan(0);
    expect(store.ensure).not.toHaveBeenCalled();
  });

  it("does not fetch a voice the owner removed", async () => {
    const { deps, store } = setup({}, { automatic: false });
    const result = await prepareVoice(deps, actor, { text: "Hello", language: "en" });
    expect(result).toEqual({ ready: false, utterances: [] });
    expect(store.ensure).not.toHaveBeenCalled();
  });

  it("reports a download that failed instead of trying again on every sentence", async () => {
    const { deps, store } = setup({ "voice-ljs": "failed" });
    await expect(prepareVoice(deps, actor, { text: "Hello", language: "en" })).rejects.toThrow(
      /could not download the voice/i,
    );
    expect(store.ensure).not.toHaveBeenCalled();
  });

  it("is not ready to speak where nothing is connected and there is no local engine", async () => {
    const { deps } = setup();
    expect(
      await prepareVoice({ ...deps, localSpeech: undefined }, actor, { text: "Hello" }),
    ).toEqual({
      ready: false,
      utterances: [],
    });
  });
});

describe("listening with nothing connected", () => {
  const audio = new Uint8Array([1, 2, 3]);

  beforeEach(() => {
    // The provider decodes real audio; the engine's own rules are tested with the provider.
    vi.spyOn(LocalVoiceProvider.prototype, "transcribe").mockResolvedValue({
      text: "olá",
      language: "pt",
    });
  });

  it("listens with the speech model on this computer and returns the language it heard", async () => {
    const { deps } = setup({ base: "ready" });
    await expect(transcribeVoice(deps, actor, { audio, mimeType: "audio/wav" })).resolves.toEqual({
      text: "olá",
      language: "pt",
    });
  });

  it("asks to connect a voice where the engine is not the owner's own", async () => {
    const { deps } = setup({ base: "ready" });
    await expect(
      transcribeVoice({ ...deps, localSpeech: undefined }, actor, { audio, mimeType: "audio/wav" }),
    ).rejects.toThrow(/voice provider key/i);
  });

  it("waits for the model's first download, then asks the client to come back", async () => {
    vi.useFakeTimers();
    const { deps, store } = setup({ base: "absent" });
    store.ensure.mockReturnValue(new Promise(() => undefined));
    const outcome = transcribeVoice(deps, actor, { audio, mimeType: "audio/wav" }).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    const error = await outcome;
    expect(error).toBeInstanceOf(LocalModelPreparing);
    expect(error).toMatchObject({
      code: "VOICE_PREPARING",
      sizeBytes: LOCAL_SPEECH_MODELS[0]?.sizeBytes,
    });
    expect(store.ensure).toHaveBeenCalledWith("base");
  });

  it("transcribes as soon as the download finishes", async () => {
    const { deps, store } = setup({ base: "absent" });
    await expect(
      transcribeVoice(deps, actor, { audio, mimeType: "audio/wav" }),
    ).resolves.toMatchObject({
      text: "olá",
    });
    expect(store.ensure).toHaveBeenCalledWith("base");
  });

  it("does not fetch a model the owner removed", async () => {
    const { deps, store } = setup({ base: "absent" }, { automatic: false });
    await expect(
      transcribeVoice(deps, actor, { audio, mimeType: "audio/wav" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(store.ensure).not.toHaveBeenCalled();
  });

  it("uses a connected provider as it is, with no download", async () => {
    const { deps, store } = setup({}, { credential: { provider: "openai" } });
    const hosted = vi.fn().mockResolvedValue({ text: "hi" });
    vi.spyOn(adapters, "createVoiceProvider").mockReturnValue({ transcribe: hosted } as never);
    await transcribeVoice(deps, actor, { audio, mimeType: "audio/wav" });
    expect(hosted).toHaveBeenCalled();
    expect(store.ensure).not.toHaveBeenCalled();
  });
});

describe("the voice routes with this computer's voices", () => {
  async function post(deps: VoiceDeps, path: string, body: unknown) {
    vi.spyOn(db, "runAsTenant").mockImplementation(((_actor: Actor, run: () => unknown) =>
      run()) as never);
    const app = new Hono();
    mountVoiceHttpRoutes(app, deps, async () => actor);
    return app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("tells the client when this computer's voice read a reply for a provider that failed", async () => {
    const { deps } = setup({ "voice-kokoro": "ready" }, { credential: { provider: "elevenlabs" } });
    paidFails(new Error("boom"), deps);
    const response = await post(deps, "/api/voice/speak", { text: "Hello", language: "en" });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-voice-fallback")).toBe("local");
    expect(response.headers.get("content-type")).toBe("audio/wav");
  });

  it("does not mark a reply that the selected voice read", async () => {
    const { deps } = setup({ "voice-pt": "ready" });
    const response = await post(deps, "/api/voice/speak", { text: "Olá", language: "pt" });
    expect(response.headers.get("x-voice-fallback")).toBeNull();
  });

  it("answers 503 with the model's size while the first download runs", async () => {
    vi.useFakeTimers();
    const { deps, store } = setup({ base: "absent" });
    store.ensure.mockReturnValue(new Promise(() => undefined));
    vi.spyOn(LocalVoiceProvider.prototype, "transcribe").mockResolvedValue({ text: "x" });
    const pending = post(deps, "/api/voice/transcribe", {
      audioBase64: "AAAA",
      mimeType: "audio/wav",
    });
    await vi.advanceTimersByTimeAsync(60_000);
    const response = await pending;
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "VOICE_PREPARING",
      sizeBytes: LOCAL_SPEECH_MODELS[0]?.sizeBytes,
    });
  });

  it("returns the language that was heard", async () => {
    const { deps } = setup({ base: "ready" });
    vi.spyOn(LocalVoiceProvider.prototype, "transcribe").mockResolvedValue({
      text: "olá",
      language: "pt",
    });
    const response = await post(deps, "/api/voice/transcribe", {
      audioBase64: "AAAA",
      mimeType: "audio/wav",
    });
    await expect(response.json()).resolves.toEqual({ text: "olá", language: "pt" });
  });
});
