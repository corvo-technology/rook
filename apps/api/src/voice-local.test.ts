import { ScriptedSynthesizer, ScriptedTranscriber } from "@corvo/adapters";
import type { Actor, LocalSpeechModel } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import * as db from "@corvo/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelLocalModelDownload,
  downloadLocalModel,
  localSpeechModels,
  persistVoiceCredential,
  removeLocalModel,
  toVoiceCredential,
  type VoiceDeps,
  voiceCatalogFor,
  voiceCredentialPlaintext,
} from "./voice.js";

const actor = { userId: "user-1", spaceId: "space-1" } as Actor;

const model = (id: string, state: LocalSpeechModel["state"] = "ready"): LocalSpeechModel => ({
  id,
  kind: "listen",
  label: id,
  sizeBytes: 1000,
  languages: ["en", "pt"],
  state,
  bytesDone: state === "ready" ? 1000 : 0,
});

function fakeStore(models: LocalSpeechModel[]) {
  return {
    list: vi.fn(async () => models),
    ensure: vi.fn(async (id: string) => `/models/${id}`),
    cancel: vi.fn(),
    allowAutomaticDownload: vi.fn(async (_kind?: string) => undefined),
    remove: vi.fn(async (_id: string) => undefined),
  };
}

function withEngine(models: LocalSpeechModel[], extra: Record<string, unknown> = {}) {
  const store = fakeStore(models);
  const deps = {
    localSpeech: {
      store,
      transcriber: new ScriptedTranscriber(),
      synthesizer: new ScriptedSynthesizer(),
    },
    ...extra,
  } as unknown as VoiceDeps;
  return { store, deps };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("voiceCatalogFor", () => {
  it("lists 'This computer' only when the engine is the owner's own", () => {
    const { deps } = withEngine([]);
    expect(voiceCatalogFor(deps).some((entry) => entry.id === "local")).toBe(true);
    expect(voiceCatalogFor({} as VoiceDeps).some((entry) => entry.id === "local")).toBe(false);
  });
});

describe("local voice credentials", () => {
  it("stores the model and language, with automatic language by default", () => {
    expect(
      JSON.parse(voiceCredentialPlaintext({ provider: "local", plaintext: "", sttModel: "base" })),
    ).toEqual({
      model: "base",
      language: "auto",
    });
    expect(
      JSON.parse(
        voiceCredentialPlaintext({
          provider: "local",
          plaintext: "",
          sttModel: "small",
          language: "pt",
        }),
      ),
    ).toEqual({ model: "small", language: "pt" });
  });

  it("leaves listening to the default model when only a voice is chosen", () => {
    expect(
      JSON.parse(voiceCredentialPlaintext({ provider: "local", plaintext: "", sttModel: " " })),
    ).toEqual({ model: "base", language: "auto" });
  });

  it("rejects an unknown language", () => {
    expect(() =>
      voiceCredentialPlaintext({
        provider: "local",
        plaintext: "",
        sttModel: "base",
        language: "xx",
      }),
    ).toThrow(/language/i);
    expect(
      JSON.parse(
        voiceCredentialPlaintext({
          provider: "local",
          plaintext: "",
          sttModel: "base",
          language: "es",
        }),
      ).language,
    ).toBe("es");
  });

  it("reports the model and language of a local connection and never a key", () => {
    const credential = toVoiceCredential({
      id: "cred-1",
      provider: "local",
      isDefault: true,
      voiceId: "",
      local: { model: "base", language: "pt" },
    });
    expect(credential).toMatchObject({
      provider: "local",
      sttModel: "base",
      language: "pt",
      transcribe: true,
    });
    expect(JSON.stringify(credential)).not.toMatch(/secret|apiKey/i);
  });
});

describe("local speech models", () => {
  it("lists the store's models, and nothing without a local engine", async () => {
    const { deps } = withEngine([model("base"), model("small", "absent")]);
    expect((await localSpeechModels(deps)).map((entry) => entry.id)).toEqual(["base", "small"]);
    expect(await localSpeechModels({} as VoiceDeps)).toEqual([]);
  });

  it("starts a download and returns at once", async () => {
    const { deps, store } = withEngine([model("base", "absent")]);
    store.ensure.mockReturnValue(new Promise(() => undefined));
    await expect(downloadLocalModel(deps, "base")).resolves.toEqual({ ok: true });
    expect(store.ensure).toHaveBeenCalledWith("base");
  });

  it("a failing download is logged, not left as an unhandled rejection", async () => {
    const { deps, store } = withEngine([model("base", "absent")]);
    store.ensure.mockRejectedValue(new Error("offline"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      await downloadLocalModel(deps, "base");
      await new Promise((resolve) => setTimeout(resolve, 10));
    } finally {
      process.off("unhandledRejection", unhandled);
    }
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("refuses a model that is not offered and a deployment without a local engine", async () => {
    const { deps, store } = withEngine([model("base", "absent")]);
    await expect(downloadLocalModel(deps, "huge")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(store.ensure).not.toHaveBeenCalled();
    await expect(downloadLocalModel({} as VoiceDeps, "base")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("lets automatic downloads resume when the owner asks for one", async () => {
    const { deps, store } = withEngine([model("base", "absent")]);
    await downloadLocalModel(deps, "base");
    expect(store.allowAutomaticDownload).toHaveBeenCalledTimes(1);
    expect(store.allowAutomaticDownload).toHaveBeenCalledWith("listen");
    const refused = withEngine([model("base", "absent")]);
    await expect(downloadLocalModel(refused.deps, "huge")).rejects.toThrow();
    expect(refused.store.allowAutomaticDownload).not.toHaveBeenCalled();
  });

  it("cancels a running download", async () => {
    const { deps, store } = withEngine([model("base", "downloading")]);
    expect(await cancelLocalModelDownload(deps, "base")).toEqual({ ok: true });
    expect(store.cancel).toHaveBeenCalledWith("base");
  });

  it("refuses to cancel an id that is not a listed model, so no marker file is written for it", async () => {
    const { deps, store } = withEngine([model("base", "downloading")]);
    await expect(cancelLocalModelDownload(deps, "../../../tmp/x")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(store.cancel).not.toHaveBeenCalled();
  });
});

function removalDeps(selected: string | undefined, models: LocalSpeechModel[]) {
  const { store, deps } = withEngine(models);
  const credentialDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    userVoiceCredential: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { id: "cred-1", secretId: "secret-1", userId: actor.userId, provider: "local" },
        ]),
      deleteMany: credentialDeleteMany,
      count: vi.fn().mockResolvedValue(0),
    },
    spaceVoicePreference: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    userVoicePreference: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    userModelCredential: { count: vi.fn().mockResolvedValue(0) },
    secret: {
      findFirst: vi.fn().mockResolvedValue({ id: "secret-1", ciphertext: "c" }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (run: (tx: typeof prisma) => unknown) =>
    run(prisma),
  );
  vi.spyOn(db, "findVoiceCredential").mockResolvedValue(
    selected ? ({ id: "cred-1", secretId: "secret-1", provider: "local" } as never) : null,
  );
  const full = {
    ...deps,
    prisma: prisma as unknown as PrismaClient,
    secrets: {
      load: vi.fn().mockReturnValue(JSON.stringify({ model: selected, language: "auto" })),
      put: vi.fn(),
    },
  } as unknown as VoiceDeps;
  return { store, deps: full, credentialDeleteMany };
}

describe("removeLocalModel", () => {
  it("removes the model and clears the selection when it was the one in use", async () => {
    const { store, deps, credentialDeleteMany } = removalDeps("base", [model("base")]);
    await expect(removeLocalModel(deps, actor, "base")).resolves.toEqual({ ok: true });
    expect(store.remove).toHaveBeenCalledWith("base");
    expect(credentialDeleteMany).toHaveBeenCalled();
  });

  it("keeps the selection when another model is the one in use", async () => {
    const { store, deps, credentialDeleteMany } = removalDeps("small", [
      model("base"),
      model("small"),
    ]);
    await removeLocalModel(deps, actor, "base");
    expect(store.remove).toHaveBeenCalledWith("base");
    expect(credentialDeleteMany).not.toHaveBeenCalled();
  });
});

describe("persistVoiceCredential for the local provider", () => {
  it("is refused where the engine is not the owner's own", async () => {
    await expect(
      persistVoiceCredential({} as VoiceDeps, actor, {
        provider: "local",
        plaintext: "",
        sttModel: "base",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("is refused for a model that is not downloaded", async () => {
    const { deps } = withEngine([model("base", "absent")]);
    await expect(
      persistVoiceCredential(deps, actor, { provider: "local", plaintext: "", sttModel: "base" }),
    ).rejects.toThrow(/download/i);
    await expect(
      persistVoiceCredential(deps, actor, { provider: "local", plaintext: "", sttModel: "nope" }),
    ).rejects.toThrow(/model/i);
  });

  it("saves the model and language, with no key, and makes it the default", async () => {
    vi.spyOn(db, "selectVoicePreference").mockResolvedValue(undefined as never);
    vi.spyOn(db, "deleteUnreferencedCredentialSecret").mockResolvedValue(undefined as never);
    const tx = {
      userVoiceCredential: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi
          .fn()
          .mockResolvedValue({ id: "cred-1", provider: "local", secretId: "secret-1" }),
      },
      secret: { create: vi.fn().mockResolvedValue({ id: "secret-1" }) },
      spaceSettingOverride: { findUnique: vi.fn().mockResolvedValue(null) },
      $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
    };
    const put = vi.fn().mockResolvedValue({ id: "secret-1", ciphertext: "n" });
    const { deps } = withEngine([model("base")], {
      prisma: {
        deploymentSettings: {
          findUnique: vi.fn().mockResolvedValue({ ownerUserId: actor.userId }),
        },
        $transaction: vi.fn((run: (client: typeof tx) => unknown) => run(tx)),
      },
      secrets: { put, load: vi.fn() },
    });
    const saved = await persistVoiceCredential(deps, actor, {
      provider: "local",
      plaintext: "",
      sttModel: "base",
      language: "pt",
    });
    expect(JSON.parse(put.mock.calls[0]?.[0] as string)).toEqual({ model: "base", language: "pt" });
    expect(saved).toMatchObject({
      provider: "local",
      isDefault: true,
      sttModel: "base",
      language: "pt",
      voiceId: "",
    });
    expect(db.selectVoicePreference).toHaveBeenCalled();
  });
});
