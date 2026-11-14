import type { AdapterContext, VoiceProvider } from "@corvo/adapter-kit";
import { VoiceAccountError } from "@corvo/adapter-kit";
import type { PrismaClient } from "@corvo/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  organizationForMember: vi.fn(),
  creditAccount: vi.fn(),
  reserveModelCredits: vi.fn(),
  settleModelCredits: vi.fn(),
  recordModelCreditReceipt: vi.fn(),
}));
vi.mock("@corvo/db", () => db);

import {
  OPENROUTER_STT_MODEL,
  OPENROUTER_TTS_MODEL,
  openRouterSpeechCostUsd,
} from "./openrouter-voice.js";
import {
  creditOrganization,
  creditVoiceKey,
  listenHoldUsd,
  speakHoldUsd,
  synthesizeOnCredits,
  transcribeOnCredits,
} from "./voice-credits.js";

const prisma = {} as PrismaClient;
const charge = { prisma, organizationId: "org", userId: "user", spaceId: "space" };
const context = { signal: new AbortController().signal } as AdapterContext;

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  db.organizationForMember.mockResolvedValue({ organizationId: "org" });
  db.creditAccount.mockResolvedValue({ mode: "credits" });
  db.reserveModelCredits.mockResolvedValue("entry");
  db.settleModelCredits.mockResolvedValue(undefined);
  db.recordModelCreditReceipt.mockResolvedValue(undefined);
});

describe("creditVoiceKey", () => {
  const key = "deploy-key";
  it("offers the deployment key only with credits on and an OpenRouter deployment key", () => {
    expect(creditVoiceKey({ creditsEnabled: true, provider: "openrouter", key })).toEqual({
      apiKey: key,
    });
    expect(creditVoiceKey({ creditsEnabled: false, provider: "openrouter", key })).toBeUndefined();
    expect(creditVoiceKey({ creditsEnabled: true, provider: "anthropic", key })).toBeUndefined();
    expect(
      creditVoiceKey({ creditsEnabled: true, provider: "openrouter", key: undefined }),
    ).toBeUndefined();
  });
});

describe("creditOrganization", () => {
  it("is the organization only while it is on credits", async () => {
    await expect(creditOrganization(prisma, { userId: "u", spaceId: "s" })).resolves.toBe("org");
    db.creditAccount.mockResolvedValue({ mode: "own_key" });
    await expect(
      creditOrganization(prisma, { userId: "u", spaceId: "s" }),
    ).resolves.toBeUndefined();
    db.organizationForMember.mockResolvedValue(null);
    await expect(
      creditOrganization(prisma, { userId: "u", spaceId: "s" }),
    ).resolves.toBeUndefined();
  });
});

describe("speaking on credits", () => {
  const request = { text: "Olá, tudo bem?", voiceId: "sarah", apiKey: "deploy-key" };

  // Two seconds of 24 kHz 16-bit mono after the 44-byte WAV header.
  const spoken = { bytes: new Uint8Array(44 + 96_000), mimeType: "audio/wav" as const };
  const twoSecondsUsd = Math.ceil(request.text.length / 4) * 0.0000005 + 2 * 25 * 0.000006;

  it("holds the priced text and settles at the length of the audio that came back", async () => {
    const provider = {
      synthesize: vi.fn().mockResolvedValue({ ...spoken, providerRequestId: "gen-1" }),
    } as unknown as VoiceProvider;
    await synthesizeOnCredits(charge, provider, request, context);
    expect(db.reserveModelCredits).toHaveBeenCalledWith(
      prisma,
      "org",
      speakHoldUsd(request.text.length),
      expect.objectContaining({
        callId: expect.stringMatching(/^voice:/),
        userId: "user",
        spaceId: "space",
        provider: "openrouter",
        model: OPENROUTER_TTS_MODEL,
      }),
    );
    expect(db.recordModelCreditReceipt).toHaveBeenCalledWith(
      prisma,
      "entry",
      expect.objectContaining({ providerRequestId: "gen-1", costSource: "estimated" }),
    );
    const [, , settled] = db.settleModelCredits.mock.calls[0] ?? [];
    expect(settled).toBeCloseTo(twoSecondsUsd, 10);
    expect(openRouterSpeechCostUsd(request.text, spoken)).toBeCloseTo(twoSecondsUsd, 10);
  });

  it("still settles when the provider gave no generation id", async () => {
    const provider = { synthesize: vi.fn().mockResolvedValue(spoken) } as unknown as VoiceProvider;
    await synthesizeOnCredits(charge, provider, request, context);
    const [, , settled] = db.settleModelCredits.mock.calls[0] ?? [];
    expect(settled).toBeCloseTo(twoSecondsUsd, 10);
  });

  it("refuses with an actionable error and synthesizes nothing when credit is short", async () => {
    db.reserveModelCredits.mockRejectedValue(
      new Error("Not enough model credits. Add credits in Billing or connect your own API key."),
    );
    const synthesize = vi.fn();
    const error = await synthesizeOnCredits(
      charge,
      { synthesize } as unknown as VoiceProvider,
      request,
      context,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(VoiceAccountError);
    expect(error).toMatchObject({
      code: "VOICE_CREDITS_USED_UP",
      message: "Add credits in Billing to keep using voice.",
    });
    expect(synthesize).not.toHaveBeenCalled();
  });

  it("gives the hold back when the provider fails", async () => {
    const provider = {
      synthesize: vi.fn().mockRejectedValue(new Error("down")),
    } as unknown as VoiceProvider;
    await expect(synthesizeOnCredits(charge, provider, request, context)).rejects.toThrow("down");
    expect(db.settleModelCredits).toHaveBeenCalledWith(prisma, "entry", 0);
  });
});

describe("listening on credits", () => {
  const request = { audio: new Uint8Array(50_000), mimeType: "audio/webm", apiKey: "deploy-key" };

  it("holds by size and settles at the reported cost", async () => {
    const provider = {
      transcribe: vi.fn().mockResolvedValue({ text: "oi", costUsd: 0.0021 }),
    } as unknown as VoiceProvider;
    await expect(transcribeOnCredits(charge, provider, request, context)).resolves.toEqual({
      text: "oi",
      costUsd: 0.0021,
    });
    expect(db.reserveModelCredits).toHaveBeenCalledWith(
      prisma,
      "org",
      listenHoldUsd(50_000),
      expect.objectContaining({ model: OPENROUTER_STT_MODEL, provider: "openrouter" }),
    );
    expect(db.recordModelCreditReceipt).toHaveBeenCalledWith(
      prisma,
      "entry",
      expect.objectContaining({ costUsd: 0.0021, costSource: "provider-reported" }),
    );
    expect(db.settleModelCredits).toHaveBeenCalledWith(prisma, "entry", 0.0021);
  });

  it("charges the hold when the reply carries no cost", async () => {
    const provider = {
      transcribe: vi.fn().mockResolvedValue({ text: "oi" }),
    } as unknown as VoiceProvider;
    await transcribeOnCredits(charge, provider, request, context);
    expect(db.settleModelCredits).toHaveBeenCalledWith(prisma, "entry", listenHoldUsd(50_000));
  });

  it("gives the hold back when the provider fails", async () => {
    const provider = {
      transcribe: vi.fn().mockRejectedValue(new Error("down")),
    } as unknown as VoiceProvider;
    await expect(transcribeOnCredits(charge, provider, request, context)).rejects.toThrow("down");
    expect(db.settleModelCredits).toHaveBeenCalledWith(prisma, "entry", 0);
  });

  it("refuses before listening when credit is short", async () => {
    db.reserveModelCredits.mockRejectedValue(new Error("Not enough model credits. Add credits"));
    const transcribe = vi.fn();
    await expect(
      transcribeOnCredits(charge, { transcribe } as unknown as VoiceProvider, request, context),
    ).rejects.toBeInstanceOf(VoiceAccountError);
    expect(transcribe).not.toHaveBeenCalled();
  });
});
