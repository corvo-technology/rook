import type { VoiceProvider } from "@corvo/adapter-kit";
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
      provider,
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
});
