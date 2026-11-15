import type { VoiceProvider } from "@corvo/adapter-kit";
import { VoiceProviderError } from "@corvo/adapter-kit";
import * as adapters from "@corvo/adapters";
import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import * as db from "@corvo/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveVoiceTarget, synthesizeVoice, transcribeVoice, type VoiceDeps } from "./voice.js";

const actor = { userId: "user", spaceId: "space" } as Actor;
const prisma = {} as PrismaClient;
const voiceCredits = { apiKey: "deploy-key", metered: true };
const deps = (extra: Partial<VoiceDeps> = {}) =>
  ({
    prisma,
    secrets: { load: vi.fn().mockReturnValue("own-key") },
    voiceCredits,
    ...extra,
  }) as unknown as VoiceDeps;

afterEach(() => vi.restoreAllMocks());

function noOwnVoice(organizationId = "org") {
  vi.spyOn(db, "findDefaultVoiceCredential").mockResolvedValue(null);
  vi.spyOn(adapters, "hostedVoiceFunding").mockResolvedValue({ organizationId });
}

describe("voice on credits", () => {
  it("falls back to the deployment voice for an organization on credits", async () => {
    noOwnVoice();
    await expect(resolveVoiceTarget(deps(), actor, { voiceId: "not-ours" })).resolves.toEqual({
      provider: "openrouter",
      apiKey: "deploy-key",
      voiceId: adapters.OPENROUTER_DEFAULT_VOICE,
      organizationId: "org",
    });
  });

  it("is not offered when the organization is not on credits", async () => {
    vi.spyOn(db, "findDefaultVoiceCredential").mockResolvedValue(null);
    vi.spyOn(adapters, "hostedVoiceFunding").mockResolvedValue(undefined);
    await expect(resolveVoiceTarget(deps(), actor, {})).rejects.toBeInstanceOf(
      adapters.NoVoiceConfigured,
    );
  });

  it("is not offered when the deployment has no credits voice", async () => {
    noOwnVoice();
    await expect(
      resolveVoiceTarget(deps({ voiceCredits: undefined }), actor, {}),
    ).rejects.toBeInstanceOf(adapters.NoVoiceConfigured);
  });

  it("keeps the person's own voice and never touches credits", async () => {
    vi.spyOn(db, "findDefaultVoiceCredential").mockResolvedValue({
      id: "c",
      userId: "user",
      provider: "elevenlabs",
      secretId: "s",
      voiceId: "v",
      speechModel: "",
    } as never);
    const credits = vi.spyOn(adapters, "hostedVoiceFunding");
    const prismaWithSecret = {
      secret: { findFirst: vi.fn().mockResolvedValue({ id: "s", ciphertext: "x" }) },
    } as unknown as PrismaClient;
    const target = await resolveVoiceTarget(deps({ prisma: prismaWithSecret }), actor, {});
    expect(target).toMatchObject({ provider: "elevenlabs", apiKey: "own-key" });
    expect(target.organizationId).toBeUndefined();
    expect(credits).not.toHaveBeenCalled();
  });

  it("charges speaking to the organization", async () => {
    noOwnVoice();
    const clip = { bytes: new Uint8Array([1]), mimeType: "audio/mpeg" as const };
    const provider = { synthesize: vi.fn().mockResolvedValue(clip) } as unknown as VoiceProvider;
    vi.spyOn(adapters, "createVoiceProvider").mockReturnValue(provider);
    const charged = vi.spyOn(adapters, "synthesizeOnCredits").mockResolvedValue(clip);
    await synthesizeVoice(deps(), actor, { text: "Olá" });
    expect(charged).toHaveBeenCalledWith(
      { prisma, organizationId: "org", userId: "user", spaceId: "space" },
      expect.objectContaining({ synthesize: expect.any(Function) }),
      expect.objectContaining({ text: "Olá", apiKey: "deploy-key" }),
      expect.anything(),
    );
    expect(provider.synthesize).not.toHaveBeenCalled();
  });

  it("speaks free on the deployment key when billing credits are off, like chat", async () => {
    vi.spyOn(db, "findDefaultVoiceCredential").mockResolvedValue(null);
    const unmetered = deps({ voiceCredits: { apiKey: "deploy-key", metered: false } });
    await expect(resolveVoiceTarget(unmetered, actor, {})).resolves.toEqual({
      provider: "openrouter",
      apiKey: "deploy-key",
      voiceId: adapters.OPENROUTER_DEFAULT_VOICE,
    });
    const clip = { bytes: new Uint8Array([1]), mimeType: "audio/mpeg" as const };
    const provider = { synthesize: vi.fn().mockResolvedValue(clip) } as unknown as VoiceProvider;
    vi.spyOn(adapters, "createVoiceProvider").mockReturnValue(provider);
    const charged = vi.spyOn(adapters, "synthesizeOnCredits");
    await synthesizeVoice(unmetered, actor, { text: "Olá" });
    expect(provider.synthesize).toHaveBeenCalledOnce();
    expect(charged).not.toHaveBeenCalled();
  });

  it("asks the deployment voice again after a passing fault, free of charge when billing is off", async () => {
    vi.spyOn(db, "findDefaultVoiceCredential").mockResolvedValue(null);
    const clip = { bytes: new Uint8Array([1]), mimeType: "audio/wav" as const };
    const synthesize = vi
      .fn()
      .mockRejectedValueOnce(new VoiceProviderError("timed out", 502))
      .mockResolvedValueOnce(clip);
    vi.spyOn(adapters, "createVoiceProvider").mockReturnValue({ synthesize } as never);
    const unmetered = deps({ voiceCredits: { apiKey: "deploy-key", metered: false } });
    await expect(synthesizeVoice(unmetered, actor, { text: "Olá" })).resolves.toBe(clip);
    expect(synthesize).toHaveBeenCalledTimes(2);
  });

  it("speaks with the fallback model only when the deployment set one", async () => {
    vi.spyOn(db, "findDefaultVoiceCredential").mockResolvedValue(null);
    const clip = { bytes: new Uint8Array([1]), mimeType: "audio/wav" as const };
    const down = () => new VoiceProviderError("down", 503);
    const synthesize = vi
      .fn()
      .mockRejectedValueOnce(down())
      .mockRejectedValueOnce(down())
      .mockResolvedValueOnce(clip);
    vi.spyOn(adapters, "createVoiceProvider").mockReturnValue({ synthesize } as never);
    const withFallback = deps({
      voiceCredits: { apiKey: "deploy-key", metered: false, fallbackModel: "vendor/backup" },
    });
    await synthesizeVoice(withFallback, actor, { text: "Olá" });
    expect(synthesize.mock.calls.map((call) => call[0].model)).toEqual([
      undefined,
      undefined,
      "vendor/backup",
    ]);

    synthesize.mockReset().mockRejectedValue(down());
    const without = deps({ voiceCredits: { apiKey: "deploy-key", metered: false } });
    await expect(synthesizeVoice(without, actor, { text: "Olá" })).rejects.toThrow("down");
    expect(synthesize).toHaveBeenCalledTimes(2);
  });

  it("charges listening to the organization", async () => {
    noOwnVoice();
    const provider = { transcribe: vi.fn() } as unknown as VoiceProvider;
    vi.spyOn(adapters, "createVoiceProvider").mockReturnValue(provider);
    const charged = vi.spyOn(adapters, "transcribeOnCredits").mockResolvedValue({ text: "oi" });
    await expect(
      transcribeVoice(deps(), actor, { audio: new Uint8Array([1, 2]), mimeType: "audio/webm" }),
    ).resolves.toEqual({ text: "oi" });
    expect(charged).toHaveBeenCalledOnce();
    expect(provider.transcribe).not.toHaveBeenCalled();
  });

  describe("transcribing in the language the person speaks", () => {
    const hosted = (transcribe: ReturnType<typeof vi.fn>) => {
      const provider = { transcribe } as unknown as VoiceProvider;
      vi.spyOn(adapters, "createVoiceProvider").mockReturnValue(provider);
      return provider;
    };
    const audio = { audio: new Uint8Array([1, 2]), mimeType: "audio/webm" };

    it("hands the credit path the candidates and never the app's language", async () => {
      noOwnVoice();
      hosted(vi.fn());
      const charged = vi.spyOn(adapters, "transcribeOnCredits").mockResolvedValue({ text: "oi" });
      await transcribeVoice(deps(), actor, { ...audio, language: "en", languages: ["pt", "en"] });
      const [, , request, , spoken] = charged.mock.calls[0] ?? [];
      expect(request?.language).toBeUndefined();
      expect(spoken).toEqual(["pt", "en"]);
    });

    it("listens again on the deployment key without credits when detection disagrees", async () => {
      vi.spyOn(db, "findDefaultVoiceCredential").mockResolvedValue(null);
      const transcribe = vi
        .fn()
        .mockResolvedValueOnce({ text: "michelle wish", language: "en" })
        .mockResolvedValueOnce({ text: "mas eu só queria", language: "pt" });
      hosted(transcribe);
      const unmetered = deps({ voiceCredits: { apiKey: "deploy-key", metered: false } });
      await expect(
        transcribeVoice(unmetered, actor, { ...audio, languages: ["pt-BR"] }),
      ).resolves.toMatchObject({ text: "mas eu só queria" });
      expect(transcribe.mock.calls[1]?.[0].language).toBe("pt");
    });

    it("does not listen again when it agrees, or with no languages like an old client", async () => {
      vi.spyOn(db, "findDefaultVoiceCredential").mockResolvedValue(null);
      const transcribe = vi.fn().mockResolvedValue({ text: "hi", language: "en" });
      hosted(transcribe);
      const unmetered = deps({ voiceCredits: { apiKey: "deploy-key", metered: false } });
      await transcribeVoice(unmetered, actor, { ...audio, languages: ["en", "pt"] });
      await transcribeVoice(unmetered, actor, { ...audio, language: "en" });
      expect(transcribe).toHaveBeenCalledTimes(2);
      expect(transcribe.mock.calls[1]?.[0].language).toBeUndefined();
    });

    it("gives a voice of their own the first language as a hint, else the old client's", async () => {
      vi.spyOn(db, "findDefaultVoiceCredential").mockResolvedValue({
        id: "c",
        userId: "user",
        provider: "elevenlabs",
        secretId: "s",
        voiceId: "v",
        speechModel: "",
      } as never);
      const transcribe = vi.fn().mockResolvedValue({ text: "oi", language: "en" });
      hosted(transcribe);
      const own = deps({
        prisma: {
          secret: { findFirst: vi.fn().mockResolvedValue({ id: "s", ciphertext: "x" }) },
        } as unknown as PrismaClient,
      });
      await transcribeVoice(own, actor, { ...audio, language: "en", languages: ["pt", "en"] });
      await transcribeVoice(own, actor, { ...audio, language: "es" });
      expect(transcribe.mock.calls.map(([request]) => request.language)).toEqual(["pt", "es"]);
    });
  });
});
